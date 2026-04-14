/**
 * CloudSyncWorker — Offline-first cloud sync queue processor.
 *
 * Polls the SQLite sync_queue every 5s, processes ready jobs sequentially,
 * and retries with exponential backoff (max 10 attempts, cap 5 min).
 *
 * Auth tokens are NEVER stored in payloads — fetched fresh at execution time.
 */
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import {
  saveConversationToSupabase,
  saveTranscriptSegments,
} from '@/features/conversations/services/conversations.service';
import { supabase } from '@/lib/supabase';

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

class CloudSyncWorkerImpl {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private started = false;

  /** Start polling the sync queue */
  start() {
    if (this.started) return;
    this.started = true;
    logger.debug('[CloudSyncWorker] Started');

    // Reset stale jobs on start
    invoke('sync_queue_reset_stale', { staleSeconds: 300 }).catch((e) =>
      console.warn('[CloudSyncWorker] Failed to reset stale jobs:', e)
    );

    // Clean up old completed jobs (>7 days)
    this.cleanupOldJobs();

    // Initial processing
    this.processQueue();

    // Poll every 5s
    this.intervalId = setInterval(() => this.processQueue(), 5000);
  }

  /** Stop polling */
  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.debug('[CloudSyncWorker] Stopped');
  }

  /** Force immediate processing (e.g., when network comes back) */
  nudge() {
    if (this.started && !this.processing) {
      this.processQueue();
    }
  }

  /**
   * Wait for a specific job to complete and return its result_data.
   * Triggers immediate queue processing and polls the job status.
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
      // Nudge again in case the worker hasn't picked it up yet
      this.nudge();
    }

    console.warn(`[CloudSyncWorker] Timeout waiting for job ${jobId} after ${timeoutMs}ms`);
    return null;
  }

  private async cleanupOldJobs() {
    try {
      const deleted = await invoke<number>('sync_queue_reset_stale', { staleSeconds: 300 });
      if (deleted > 0) logger.debug(`[CloudSyncWorker] Reset ${deleted} stale jobs`);
    } catch { /* ignore */ }
  }

  private async processQueue() {
    if (this.processing || !this.started) return;
    this.processing = true;

    try {
      const jobs = await invoke<SyncQueueJob[]>('sync_queue_get_ready_jobs', { limit: 5 });
      if (jobs.length === 0) return;

      logger.debug(`[CloudSyncWorker] Processing ${jobs.length} ready job(s)`);

      for (const job of jobs) {
        if (!this.started) break;
        await this.processJob(job);
      }
    } catch (e) {
      console.warn('[CloudSyncWorker] Failed to fetch ready jobs:', e);
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: SyncQueueJob) {
    // Claim the job
    try {
      const claimed = await invoke<boolean>('sync_queue_claim_job', { id: job.id });
      if (!claimed) {
        logger.debug(`[CloudSyncWorker] Job ${job.id} already claimed, skipping`);
        return;
      }
    } catch (e) {
      console.warn(`[CloudSyncWorker] Failed to claim job ${job.id}:`, e);
      return;
    }

    try {
      const result = await this.executeJob(job);
      await invoke('sync_queue_complete_job', {
        id: job.id,
        resultData: result ? JSON.stringify(result) : null,
      });
      logger.debug(`[CloudSyncWorker] Job ${job.id} (${job.job_type}) completed`);

      // Emit sync status changed event for UI updates
      window.dispatchEvent(new CustomEvent('sync-status-changed', {
        detail: { meetingId: job.meeting_id, jobType: job.job_type, status: 'completed' },
      }));
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const nextAttempt = job.attempt_count + 1;
      const nextRetryAt = this.calculateNextRetry(nextAttempt);

      console.warn(
        `[CloudSyncWorker] Job ${job.id} (${job.job_type}) failed (attempt ${nextAttempt}/${job.max_attempts}): ${errorMsg}`
      );

      await invoke('sync_queue_fail_job', {
        id: job.id,
        errorMsg,
        nextRetryAt: nextAttempt < job.max_attempts ? nextRetryAt : null,
      }).catch((err) =>
        console.error(`[CloudSyncWorker] Failed to mark job ${job.id} as failed:`, err)
      );

      // Emit for UI
      window.dispatchEvent(new CustomEvent('sync-status-changed', {
        detail: {
          meetingId: job.meeting_id,
          jobType: job.job_type,
          status: nextAttempt >= job.max_attempts ? 'failed' : 'retrying',
        },
      }));
    }
  }

  private async executeJob(job: SyncQueueJob): Promise<Record<string, unknown> | null> {
    const payload = JSON.parse(job.payload);

    switch (job.job_type) {
      case 'save_conversation':
        return this.executeSaveConversation(payload);
      case 'save_transcript_segments':
        return this.executeSaveTranscriptSegments(job, payload);
      case 'finalize_conversation':
        return this.executeFinalizeConversation(job, payload);
      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }
  }

  private async executeSaveConversation(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Ensure we have a valid session
    await this.ensureAuth();

    const conversationId = await saveConversationToSupabase({
      user_id: payload.user_id as string,
      title: payload.title as string,
      started_at: payload.started_at as string,
      finished_at: payload.finished_at as string,
      transcript_text: payload.transcript_text as string,
      source: (payload.source as string) ?? 'maity_desktop',
      language: payload.language as string | undefined,
      words_count: payload.words_count as number | undefined,
      duration_seconds: payload.duration_seconds as number | undefined,
    });

    return { conversation_id: conversationId };
  }

  private async executeSaveTranscriptSegments(
    job: SyncQueueJob,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();

    // Get conversation_id from dependency result
    const depResult = await invoke<string | null>('sync_queue_get_dependency_result', {
      jobId: job.id,
    });

    if (!depResult) {
      throw new Error('Dependency result (conversation_id) not found');
    }

    const { conversation_id: conversationId } = JSON.parse(depResult);
    if (!conversationId) {
      throw new Error('conversation_id missing from dependency result');
    }

    const segments = payload.segments as Array<{
      segment_index: number;
      text: string;
      speaker: string;
      speaker_id: number;
      is_user: boolean;
      start_time: number;
      end_time: number;
    }>;

    await saveTranscriptSegments(
      conversationId,
      payload.user_id as string,
      segments
    );

    // Pass conversation_id forward so finalize job can read it from its dependency
    return { conversation_id: conversationId };
  }

  private async executeFinalizeConversation(
    job: SyncQueueJob,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Get fresh access token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('No active session for finalize — user must re-authenticate');
    }

    // Get conversation_id from dependency result (save_transcript_segments passes it forward)
    const depResult = await invoke<string | null>('sync_queue_get_dependency_result', {
      jobId: job.id,
    });

    let conversationId: string | null = null;
    if (depResult) {
      try {
        const parsed = JSON.parse(depResult);
        conversationId = parsed.conversation_id || null;
      } catch { /* ignore parse error */ }
    }

    if (!conversationId) {
      throw new Error('Could not determine conversation_id for finalize');
    }

    const result = await invoke<{ ok: boolean; error?: string }>('finalize_conversation_cloud', {
      conversationId,
      durationSeconds: payload.duration_seconds as number,
      accessToken: session.access_token,
    });

    if (!result.ok) {
      throw new Error(result.error || 'Finalize returned ok=false');
    }

    // Notify UI that finalize completed
    window.dispatchEvent(new CustomEvent('finalize-completed', {
      detail: { conversationId, meetingId: job.meeting_id },
    }));

    return { ok: true, conversation_id: conversationId };
  }

  private async ensureAuth(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Try refreshing
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        throw new Error('No active session — user must re-authenticate');
      }
    }
  }

  /** Calculate next_retry_at ISO string with exponential backoff + jitter */
  private calculateNextRetry(attemptNumber: number): string {
    const baseDelay = Math.min(1000 * Math.pow(2, attemptNumber - 1), 300000); // cap at 5 min
    const jitter = baseDelay * (0.3 * Math.random()); // 0-30% jitter
    const delayMs = baseDelay + jitter;
    const retryAt = new Date(Date.now() + delayMs);
    return retryAt.toISOString();
  }
}

/** Singleton instance */
export const cloudSyncWorker = new CloudSyncWorkerImpl();
