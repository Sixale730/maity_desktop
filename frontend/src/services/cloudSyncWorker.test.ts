import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * El worker JS ya NO ejecuta jobs (lo hace el loop headless de Rust,
 * `cloud_sync/worker.rs`). Lo que queda testeable acá es:
 *  - el puente `cloud-sync-status-changed` (Tauri) → `sync-status-changed` (DOM),
 *  - el ciclo start/stop (idempotencia + limpieza del listener),
 *  - `nudge()` como invoke a `cloud_sync_nudge`,
 *  - `waitForJobResult` (polling de un job que ahora completa Rust).
 */

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
/** Handler registrado por el puente; se dispara a mano en los tests. */
let statusHandler: ((event: { payload: unknown }) => void) | null = null;

const supabaseLimitMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) =>
    listenMock(event, handler),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({
                limit: () => supabaseLimitMock(),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { cloudSyncWorker } from './cloudSyncWorker';
import { TauriEvent } from '@/lib/tauri-events';

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('cloudSyncWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    supabaseLimitMock.mockReset();
    statusHandler = null;

    invokeMock.mockResolvedValue(null);
    supabaseLimitMock.mockResolvedValue({ data: [], error: null });
    listenMock.mockImplementation(
      async (_event: string, handler: (e: { payload: unknown }) => void) => {
        statusHandler = handler;
        return unlistenMock;
      }
    );
  });

  afterEach(() => {
    cloudSyncWorker.stop();
    vi.useRealTimers();
  });

  it('no ejecuta jobs: nunca pide ni toma jobs de la cola (eso es de Rust)', async () => {
    cloudSyncWorker.start('user-1');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_000);

    const executorCommands = invokeMock.mock.calls
      .map((c) => c[0] as string)
      .filter((cmd) =>
        [
          'sync_queue_get_ready_jobs',
          'sync_queue_claim_job',
          'sync_queue_complete_job',
          'sync_queue_fail_job',
          'sync_queue_defer_job',
        ].includes(cmd)
      );
    expect(executorCommands).toEqual([]);
  });

  it('start registra el puente de eventos una sola vez (idempotente)', async () => {
    cloudSyncWorker.start('user-1');
    cloudSyncWorker.start('user-1');
    cloudSyncWorker.start('user-1');
    await flushMicrotasks();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0][0]).toBe(TauriEvent.CLOUD_SYNC_STATUS_CHANGED);
  });

  it('reenvía cloud-sync-status-changed como CustomEvent sync-status-changed', async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sync-status-changed', listener);

    cloudSyncWorker.start('user-1');
    await flushMicrotasks();

    expect(statusHandler).toBeTypeOf('function');
    statusHandler!({
      payload: {
        meetingId: 'm-1',
        jobType: 'finalize_conversation',
        status: 'completed',
      },
    });

    window.removeEventListener('sync-status-changed', listener);

    expect(events).toHaveLength(1);
    // Las keys son las que filtran useCloudSyncStatuses, /conversations y
    // PlanIndicator: si cambian, esos listeners dejan de disparar en silencio.
    expect(events[0].detail).toEqual({
      meetingId: 'm-1',
      jobType: 'finalize_conversation',
      status: 'completed',
    });
  });

  it('propaga el campo error cuando el job falla o se difiere', async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sync-status-changed', listener);

    cloudSyncWorker.start('user-1');
    await flushMicrotasks();

    statusHandler!({
      payload: {
        meetingId: 'm-2',
        jobType: 'save_conversation',
        status: 'retrying',
        error: 'network:sin internet',
      },
    });

    window.removeEventListener('sync-status-changed', listener);

    expect(events[0].detail).toMatchObject({
      status: 'retrying',
      error: 'network:sin internet',
    });
  });

  it('stop libera el listener y deja de reenviar', async () => {
    cloudSyncWorker.start('user-1');
    await flushMicrotasks();

    const capturedHandler = statusHandler!;
    cloudSyncWorker.stop();
    expect(unlistenMock).toHaveBeenCalledTimes(1);

    // Aunque llegara un evento tardío, ya no hay nadie escuchando del lado Tauri;
    // se comprueba que el ciclo start→stop→start no duplica listeners.
    cloudSyncWorker.start('user-1');
    await flushMicrotasks();
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(statusHandler).not.toBe(capturedHandler);
  });

  it('nudge invoca cloud_sync_nudge (despierta al consumidor de Rust)', async () => {
    invokeMock.mockClear();
    cloudSyncWorker.nudge();
    await flushMicrotasks();

    expect(invokeMock.mock.calls.some((c) => c[0] === 'cloud_sync_nudge')).toBe(true);
  });

  it('el stuck-watcher corre al arrancar y cada minuto', async () => {
    cloudSyncWorker.start('user-1');
    await flushMicrotasks();
    expect(supabaseLimitMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(supabaseLimitMock).toHaveBeenCalledTimes(2);

    cloudSyncWorker.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(supabaseLimitMock).toHaveBeenCalledTimes(2);
  });

  it('waitForJobResult returns parsed result_data when job completes', async () => {
    let callCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
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

    cloudSyncWorker.start('user-1');

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 10_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toEqual({ conversation_id: 'abc' });
  });

  it('waitForJobResult returns null when job fails', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sync_queue_get_job') {
        return { id: 5, status: 'failed', last_error: 'boom', result_data: null };
      }
      return null;
    });

    cloudSyncWorker.start('user-1');

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });

  it('waitForJobResult returns null on timeout', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sync_queue_get_job') {
        return { id: 5, status: 'in_progress', result_data: null };
      }
      return null;
    });

    cloudSyncWorker.start('user-1');

    const resultPromise = cloudSyncWorker.waitForJobResult(5, 3_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });
});
