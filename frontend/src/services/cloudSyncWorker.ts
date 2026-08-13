/**
 * CloudSyncWorker — puente de UI sobre la cola de sync cloud.
 *
 * YA NO EJECUTA JOBS. Desde jul-2026 el único consumidor de `sync_queue` es el
 * loop headless de Rust (`src-tauri/src/cloud_sync/worker.rs`): en jornada la
 * ventana vive oculta en el tray y WebView2 suspende el JS off-screen, así que
 * un `setInterval` en el webview dejaba los jobs sin drenar durante horas
 * (badge "Sincronizando…" eterno). Reintroducir aquí un ejecutor volvería a
 * competir con Rust por el mismo `claim_job`.
 *
 * Lo que sí sigue viviendo en el webview:
 *  - Puente de eventos: `cloud-sync-status-changed` (Tauri, emitido por Rust) →
 *    `CustomEvent('sync-status-changed')` (bus DOM), que es lo que escuchan
 *    `useCloudSyncStatuses`, `/conversations` y `PlanIndicator`.
 *  - Stuck-watcher: necesita supabase-js para consultar `omi_conversations` y
 *    solo tiene sentido con la ventana viva, así que se queda en JS.
 *  - `waitForJobResult`: polling de un job puntual para los flujos de UI que
 *    esperan un resultado (los jobs los completa Rust; el polling no cambia).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import { logPoll } from '@/lib/diagnostics';
import { supabase } from '@/lib/supabase';
import { TauriEvent } from '@/lib/tauri-events';
import { isQuotaBlocked, markQuotaBlocked, parseQuotaError } from '@/lib/quotaErrors';

interface SyncQueueJob {
  id: number;
  job_type: string;
  meeting_id: string;
  payload: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  depends_on: number | null;
  result_data: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Payload del evento Tauri que emite el loop de Rust en cada transición. */
export interface CloudSyncStatusPayload {
  meetingId: string;
  jobType: string;
  status: 'completed' | 'retrying' | 'failed';
  error?: string;
}

/** Cadencia del stuck-watcher. Antes se colgaba del loop de 5s del ejecutor;
 *  ahora que el ejecutor no existe, tiene su propio interval. */
const STUCK_CHECK_INTERVAL_MS = 60_000;
/** A row in 'processing' whose updated_at is older than this is considered stuck.
 *  Aligned with STALL_TIMEOUT_PROCESSING_MS in derivePhase.ts (3 min, 6 missed heartbeats). */
const STUCK_THRESHOLD_MS = 3 * 60 * 1000;

class CloudSyncWorkerImpl {
  private stuckIntervalId: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private currentUserId: string | null = null;
  private unlistenStatus: UnlistenFn | null = null;
  private checkingStuck = false;

  /** Monta el puente de eventos y el stuck-watcher. `userId` es el
   *  `maityUser.id` (FK de `omi_conversations.user_id`). */
  start(userId: string) {
    logPoll('sync_worker_start_called', { userId, alreadyStarted: this.started });
    if (this.started) return;
    this.started = true;
    this.currentUserId = userId;
    logger.debug(`[CloudSyncWorker] Started for user ${userId}`);

    // Puente Rust → bus DOM. Se registra de forma asíncrona; si `stop()` gana
    // la carrera, el unlisten se aplica de inmediato para no dejar listeners
    // colgados entre logins.
    void listen<CloudSyncStatusPayload>(TauriEvent.CLOUD_SYNC_STATUS_CHANGED, (event) => {
      window.dispatchEvent(
        new CustomEvent('sync-status-changed', { detail: event.payload })
      );
    })
      .then((unlisten) => {
        if (!this.started) {
          unlisten();
          return;
        }
        this.unlistenStatus = unlisten;
      })
      .catch((e) => {
        console.warn('[CloudSyncWorker] Failed to bridge cloud-sync-status-changed:', e);
      });

    // Despierta al consumidor de Rust por si quedaron jobs de la sesión previa.
    this.nudge();

    void this.checkStuckConversations().catch((e) =>
      console.warn('[CloudSyncWorker] stuck-watcher error:', e)
    );
    this.stuckIntervalId = setInterval(() => {
      void this.checkStuckConversations().catch((e) =>
        console.warn('[CloudSyncWorker] stuck-watcher error:', e)
      );
    }, STUCK_CHECK_INTERVAL_MS);

    logPoll('sync_worker_started', { userId });
  }

  /** Desmonta el puente y el stuck-watcher. El consumidor de Rust sigue
   *  corriendo: es headless a propósito. */
  stop() {
    logPoll('sync_worker_stop_called', {
      hadInterval: !!this.stuckIntervalId,
      started: this.started,
    });
    if (!this.started) return;
    this.started = false;
    this.currentUserId = null;
    if (this.stuckIntervalId) {
      clearInterval(this.stuckIntervalId);
      this.stuckIntervalId = null;
    }
    if (this.unlistenStatus) {
      this.unlistenStatus();
      this.unlistenStatus = null;
    }
    logger.debug('[CloudSyncWorker] Stopped');
  }

  /** Despierta al loop de Rust sin esperar su tick de 5s (p. ej. al volver la
   *  red, o justo después de encolar). Nombre público conservado: lo llama
   *  `CloudSyncInitializer` en el evento 'online'. */
  nudge() {
    void invoke('cloud_sync_nudge').catch((e) =>
      console.warn('[CloudSyncWorker] nudge failed:', e)
    );
  }

  /**
   * Wait for a specific job to complete and return its result_data.
   * Nudges the Rust consumer and polls the job status.
   * Returns parsed result_data or null on timeout/failure.
   */
  async waitForJobResult(jobId: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
    this.nudge();
    const start = Date.now();
    const POLL_INTERVAL = 1500;

    while (Date.now() - start < timeoutMs) {
      try {
        const job = await invoke<SyncQueueJob | null>('sync_queue_get_job', { id: jobId });
        if (job?.status === 'completed' && job.result_data) {
          return JSON.parse(job.result_data);
        }
        if (job?.status === 'failed') {
          console.warn(`[CloudSyncWorker] Job ${jobId} failed: ${job.last_error}`);
          return null;
        }
      } catch (e) {
        console.warn(`[CloudSyncWorker] Error polling job ${jobId}:`, e);
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      // Nudge again in case the consumer hasn't picked it up yet
      this.nudge();
    }

    console.warn(`[CloudSyncWorker] Timeout waiting for job ${jobId} after ${timeoutMs}ms`);
    return null;
  }

  /** Scan the user's cloud conversations for rows that have been in 'processing'
   *  longer than the heartbeat threshold and dispatch a transparent retry. The
   *  backend dedupes via analysis_dispatch_locks, so this is safe to run alongside
   *  the per-row self-healing in useConversationLive.
   */
  private async checkStuckConversations(): Promise<void> {
    if (!this.currentUserId || this.checkingStuck) return;
    this.checkingStuck = true;
    try {
      const userId = this.currentUserId;
      const thresholdIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
      const { data: stuck, error } = await supabase
        .schema('maity')
        .from('omi_conversations')
        .select('id, updated_at')
        .eq('user_id', userId)
        .eq('analysis_status', 'processing')
        .lt('updated_at', thresholdIso)
        .limit(10);

      if (error) {
        console.warn('[CloudSyncWorker] stuck check query failed:', error.message);
        return;
      }
      if (!stuck || stuck.length === 0) return;

      logPoll('stuck_watcher_found', {
        count: stuck.length,
        ids: stuck.map((c) => c.id),
      });
      logger.info(`[CloudSyncWorker] Found ${stuck.length} stuck conversation(s), dispatching retry`);
      // Dynamic import avoids a circular dependency between this worker and the
      // conversations service (the service indirectly references this module).
      const { reanalyzeConversation } = await import(
        '@/features/conversations/services/conversations.service'
      );
      for (const conv of stuck) {
        // Una conversación bloqueada por cuota no está "stuck": reintentarla
        // solo vuelve a pegar la cuota. Se salta hasta el siguiente período.
        if (isQuotaBlocked(conv.id)) continue;
        try {
          await reanalyzeConversation(conv.id, '', 'es');
          logPoll('stuck_watcher_reanalyze_dispatched', { id: conv.id });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const quota = parseQuotaError(msg);
          if (quota) markQuotaBlocked(conv.id, quota.period);
          logPoll('stuck_watcher_reanalyze_failed', { id: conv.id, error: msg });
          console.warn(`[CloudSyncWorker] Stuck retry failed for ${conv.id}:`, e);
        }
      }
    } finally {
      this.checkingStuck = false;
    }
  }
}

/** Singleton instance */
export const cloudSyncWorker = new CloudSyncWorkerImpl();
