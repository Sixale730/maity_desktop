import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeMock = vi.fn(async () => null);
const getSessionMock = vi.fn(async () => ({ data: { session: null } }));
const getOmiConversationMock = vi.fn();
const checkAnalysisStatusMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock('@/features/conversations/services/conversations.service', () => ({
  getOmiConversation: (...args: unknown[]) => getOmiConversationMock(...args),
  checkAnalysisStatus: (...args: unknown[]) => checkAnalysisStatusMock(...args),
  isFullAnalysis: (v: unknown) => v != null && typeof v === 'object' && 'some' in (v as object),
  isAnalysisSkipped: (v: unknown) => v != null && typeof v === 'object' && 'skipped' in (v as object),
}));

import { analysisPollingService, ANALYSIS_STATE_CHANGED } from './analysisPollingService';

describe('analysisPollingService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    invokeMock.mockClear();
    getSessionMock.mockClear();
    getOmiConversationMock.mockClear();
    checkAnalysisStatusMock.mockClear();
  });

  afterEach(() => {
    // Clean any still-tracked entries from previous test (singleton leaks state)
    const ids = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'supabase-id'];
    for (const id of ids) {
      analysisPollingService.untrack(id);
      analysisPollingService.untrack(id, 'local-abc');
    }
    analysisPollingService.stop();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('track() adds a conversation with phase "polling"', () => {
    analysisPollingService.track({
      conversationId: 'c-1',
      source: 'cloud',
      durationSeconds: 60,
    });

    const state = analysisPollingService.getState('c-1');
    expect(state).not.toBeNull();
    expect(state?.phase).toBe('polling');
    expect(state?.conversationId).toBe('c-1');
    expect(state?.durationSeconds).toBe(60);
    expect(state?.hasV4).toBe(false);
    expect(state?.hasMinuta).toBe(false);
  });

  it('track() is idempotent when already polling the same conversation', () => {
    analysisPollingService.track({ conversationId: 'c-2', source: 'cloud' });
    const firstState = analysisPollingService.getState('c-2');

    analysisPollingService.track({
      conversationId: 'c-2',
      source: 'cloud',
      initialHasV4: true, // would normally update
    });

    const secondState = analysisPollingService.getState('c-2');
    // Should NOT have been reset with the new initialHasV4
    expect(secondState?.hasV4).toBe(firstState?.hasV4);
  });

  it('untrack() removes the conversation from state', () => {
    analysisPollingService.track({ conversationId: 'c-3', source: 'cloud' });
    expect(analysisPollingService.getState('c-3')).not.toBeNull();

    analysisPollingService.untrack('c-3');
    expect(analysisPollingService.getState('c-3')).toBeNull();
  });

  it('hasActiveAnalysis() reflects presence of polling or retrying entries', () => {
    expect(analysisPollingService.hasActiveAnalysis()).toBe(false);

    analysisPollingService.track({ conversationId: 'c-4', source: 'cloud' });
    expect(analysisPollingService.hasActiveAnalysis()).toBe(true);

    analysisPollingService.untrack('c-4');
    expect(analysisPollingService.hasActiveAnalysis()).toBe(false);
  });

  it('getState() falls back to searching by localId', () => {
    analysisPollingService.track({
      conversationId: 'supabase-id',
      localId: 'local-abc',
      source: 'local',
    });

    // Look up by localId as second argument
    const byLocal = analysisPollingService.getState('supabase-id', 'local-abc');
    expect(byLocal?.localId).toBe('local-abc');

    // Look up by localId as first argument (fallback path)
    const byLocalAsFirst = analysisPollingService.getState('local-abc');
    expect(byLocalAsFirst?.localId).toBe('local-abc');

    analysisPollingService.untrack('supabase-id', 'local-abc');
  });

  it('restartPolling() resets state to initial polling values', () => {
    analysisPollingService.track({
      conversationId: 'c-5',
      source: 'cloud',
      initialHasV4: false,
    });

    // Simulate prior error by retrying manually (transitions phase)
    analysisPollingService.retryManually('c-5');
    const midState = analysisPollingService.getState('c-5');
    expect(midState?.retryCount).toBeGreaterThan(0);

    analysisPollingService.restartPolling('c-5');
    const reset = analysisPollingService.getState('c-5');
    expect(reset?.phase).toBe('polling');
    expect(reset?.retryCount).toBe(0);
    expect(reset?.hasV4).toBe(false);
    expect(reset?.hasMinuta).toBe(false);
    expect(reset?.error).toBeNull();

    analysisPollingService.untrack('c-5');
  });

  it('track() dispatches a state-changed CustomEvent with {key, state}', () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(ANALYSIS_STATE_CHANGED, listener);

    analysisPollingService.track({ conversationId: 'c-6', source: 'cloud' });

    window.removeEventListener(ANALYSIS_STATE_CHANGED, listener);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const detail = events[0].detail as { key: string; state: { conversationId: string; phase: string } };
    expect(detail.key).toBe('c-6');
    expect(detail.state.conversationId).toBe('c-6');
    expect(detail.state.phase).toBe('polling');

    analysisPollingService.untrack('c-6');
  });

  it('start/stop lifecycle is idempotent', () => {
    analysisPollingService.start();
    analysisPollingService.start();
    analysisPollingService.start();
    analysisPollingService.stop();
    analysisPollingService.stop();
    // No assertion — if this passes without throwing, the lifecycle is safe
  });
});
