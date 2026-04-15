import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeMock = vi.fn();
const saveConversationToSupabaseMock = vi.fn();
const saveTranscriptSegmentsMock = vi.fn();
const getSessionMock = vi.fn();
const refreshSessionMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

vi.mock('@/features/conversations/services/conversations.service', () => ({
  saveConversationToSupabase: (...args: unknown[]) => saveConversationToSupabaseMock(...args),
  saveTranscriptSegments: (...args: unknown[]) => saveTranscriptSegmentsMock(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      refreshSession: () => refreshSessionMock(),
    },
  },
}));

import { cloudSyncWorker } from './cloudSyncWorker';

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('cloudSyncWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    saveConversationToSupabaseMock.mockReset();
    saveTranscriptSegmentsMock.mockReset();
    getSessionMock.mockReset();
    refreshSessionMock.mockReset();

    invokeMock.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'sync_queue_reset_stale':
          return 0;
        case 'sync_queue_get_ready_jobs':
          return [];
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cloudSyncWorker.stop();
    vi.useRealTimers();
  });

  it('start is idempotent', () => {
    cloudSyncWorker.start();
    cloudSyncWorker.start();
    cloudSyncWorker.start();
    // Expect only one setInterval and one initial call path
    const resetStaleCalls = invokeMock.mock.calls.filter(c => c[0] === 'sync_queue_reset_stale');
    // start calls reset_stale + cleanupOldJobs (which also calls reset_stale) → 2 total per start
    // Calling start 3 times should NOT produce 6 calls
    expect(resetStaleCalls.length).toBeLessThanOrEqual(2);
  });

  it('stop clears the interval and does not process further jobs', async () => {
    cloudSyncWorker.start();
    await flushMicrotasks();
    cloudSyncWorker.stop();

    const callsBefore = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    // Ready jobs should NOT be polled after stop
    const newReadyCalls = invokeMock.mock.calls
      .slice(callsBefore)
      .filter(c => c[0] === 'sync_queue_get_ready_jobs');
    expect(newReadyCalls.length).toBe(0);
  });

  it('nudge forces immediate processing when started', async () => {
    cloudSyncWorker.start();
    await flushMicrotasks();

    const callsBefore = invokeMock.mock.calls.length;
    cloudSyncWorker.nudge();
    await flushMicrotasks();

    const newReadyCalls = invokeMock.mock.calls
      .slice(callsBefore)
      .filter(c => c[0] === 'sync_queue_get_ready_jobs');
    expect(newReadyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('nudge does nothing when not started', async () => {
    cloudSyncWorker.nudge();
    await flushMicrotasks();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('save_conversation job: claims, executes, completes and emits sync-status-changed', async () => {
    const job = {
      id: 42,
      job_type: 'save_conversation',
      meeting_id: 'm-1',
      payload: JSON.stringify({
        user_id: 'u',
        title: 't',
        started_at: 's',
        finished_at: 'f',
        transcript_text: 'hola',
        source: 'desktop',
      }),
      status: 'pending',
      attempt_count: 0,
      max_attempts: 10,
      next_retry_at: null,
      last_error: null,
      depends_on: null,
      result_data: null,
      created_at: '',
      updated_at: '',
      completed_at: null,
    };

    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    saveConversationToSupabaseMock.mockResolvedValue('conv-abc');

    invokeMock.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'sync_queue_reset_stale': return 0;
        case 'sync_queue_get_ready_jobs': return [job];
        case 'sync_queue_claim_job': return true;
        case 'sync_queue_complete_job': return true;
        default: return null;
      }
    });

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sync-status-changed', listener);

    cloudSyncWorker.start();
    await flushMicrotasks();
    await flushMicrotasks();

    window.removeEventListener('sync-status-changed', listener);

    expect(saveConversationToSupabaseMock).toHaveBeenCalledTimes(1);

    const completeCall = invokeMock.mock.calls.find(c => c[0] === 'sync_queue_complete_job');
    expect(completeCall).toBeDefined();
    const completeArgs = completeCall![1] as { id: number; resultData: string };
    expect(completeArgs.id).toBe(42);
    expect(JSON.parse(completeArgs.resultData)).toEqual({ conversation_id: 'conv-abc' });

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      meetingId: 'm-1',
      jobType: 'save_conversation',
      status: 'completed',
    });
  });

  it('failed job: increments retry with exponential backoff and emits "retrying"', async () => {
    const job = {
      id: 7,
      job_type: 'save_conversation',
      meeting_id: 'm-2',
      payload: JSON.stringify({ user_id: 'u', title: 't', started_at: 's', finished_at: 'f', transcript_text: '', source: 'x' }),
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      depends_on: null,
      result_data: null,
      created_at: '',
      updated_at: '',
      completed_at: null,
    };

    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    saveConversationToSupabaseMock.mockRejectedValue(new Error('network down'));

    invokeMock.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'sync_queue_reset_stale': return 0;
        case 'sync_queue_get_ready_jobs': return [job];
        case 'sync_queue_claim_job': return true;
        case 'sync_queue_fail_job': return true;
        default: return null;
      }
    });

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sync-status-changed', listener);

    cloudSyncWorker.start();
    await flushMicrotasks();
    await flushMicrotasks();

    window.removeEventListener('sync-status-changed', listener);

    const failCall = invokeMock.mock.calls.find(c => c[0] === 'sync_queue_fail_job');
    expect(failCall).toBeDefined();
    const failArgs = failCall![1] as { id: number; errorMsg: string; nextRetryAt: string | null };
    expect(failArgs.id).toBe(7);
    expect(failArgs.errorMsg).toContain('network down');
    // Not yet exhausted → should schedule a retry
    expect(failArgs.nextRetryAt).toBeTruthy();

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      meetingId: 'm-2',
      jobType: 'save_conversation',
      status: 'retrying',
    });
  });

  it('failed job at max_attempts emits "failed" and sets nextRetryAt to null', async () => {
    const job = {
      id: 9,
      job_type: 'save_conversation',
      meeting_id: 'm-3',
      payload: JSON.stringify({ user_id: 'u', title: 't', started_at: 's', finished_at: 'f', transcript_text: '', source: 'x' }),
      status: 'pending',
      attempt_count: 4,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      depends_on: null,
      result_data: null,
      created_at: '',
      updated_at: '',
      completed_at: null,
    };

    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    saveConversationToSupabaseMock.mockRejectedValue(new Error('permanent failure'));

    invokeMock.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'sync_queue_reset_stale': return 0;
        case 'sync_queue_get_ready_jobs': return [job];
        case 'sync_queue_claim_job': return true;
        case 'sync_queue_fail_job': return true;
        default: return null;
      }
    });

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sync-status-changed', listener);

    cloudSyncWorker.start();
    await flushMicrotasks();
    await flushMicrotasks();

    window.removeEventListener('sync-status-changed', listener);

    const failCall = invokeMock.mock.calls.find(c => c[0] === 'sync_queue_fail_job');
    const failArgs = failCall![1] as { nextRetryAt: string | null };
    // attempt_count + 1 = 5 === max_attempts → nextRetryAt = null
    expect(failArgs.nextRetryAt).toBeNull();

    expect(events[0].detail.status).toBe('failed');
  });

  it('skips execution when claim returns false (someone else got the job)', async () => {
    const job = {
      id: 11,
      job_type: 'save_conversation',
      meeting_id: 'm-4',
      payload: JSON.stringify({}),
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_retry_at: null,
      last_error: null,
      depends_on: null,
      result_data: null,
      created_at: '',
      updated_at: '',
      completed_at: null,
    };

    invokeMock.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'sync_queue_reset_stale': return 0;
        case 'sync_queue_get_ready_jobs': return [job];
        case 'sync_queue_claim_job': return false;
        default: return null;
      }
    });

    cloudSyncWorker.start();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(saveConversationToSupabaseMock).not.toHaveBeenCalled();
    const completeCall = invokeMock.mock.calls.find(c => c[0] === 'sync_queue_complete_job');
    expect(completeCall).toBeUndefined();
  });

  it('waitForJobResult returns parsed result_data when job completes', async () => {
    let callCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sync_queue_reset_stale') return 0;
      if (cmd === 'sync_queue_get_ready_jobs') return [];
      if (cmd === 'sync_queue_get_job') {
        callCount++;
        if (callCount >= 2) {
          return {
            id: 5,
            status: 'completed',
            result_data: JSON.stringify({ conversation_id: 'abc' }),
          };
        }
        return { id: 5, status: 'in_progress', result_data: null };
      }
      return null;
    });

    cloudSyncWorker.start();

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 10_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toEqual({ conversation_id: 'abc' });
  });

  it('waitForJobResult returns null when job fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sync_queue_reset_stale') return 0;
      if (cmd === 'sync_queue_get_ready_jobs') return [];
      if (cmd === 'sync_queue_get_job') {
        return { id: 5, status: 'failed', last_error: 'boom', result_data: null };
      }
      return null;
    });

    cloudSyncWorker.start();

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });

  it('waitForJobResult returns null on timeout', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sync_queue_reset_stale') return 0;
      if (cmd === 'sync_queue_get_ready_jobs') return [];
      if (cmd === 'sync_queue_get_job') {
        return { id: 5, status: 'in_progress', result_data: null };
      }
      return null;
    });

    cloudSyncWorker.start();

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 3_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });
});
