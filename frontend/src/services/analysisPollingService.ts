/**
 * AnalysisPollingService — Global singleton that tracks analysis progress
 * for conversations, surviving page navigation.
 *
 * Follows the same pattern as CloudSyncWorker:
 * - Singleton class with start/stop lifecycle
 * - React bridge (AnalysisPollingInitializer) mounted in layout.tsx
 * - Dispatches window CustomEvents for UI subscribers
 *
 * Uses `analysis_status` column for lightweight polling (20s interval).
 * Only fetches full conversation data when status reaches a terminal state.
 * Falls back to checking communication_feedback_v4 when analysis_status is null
 * (backward compatibility during transition before web app sets the field).
 */
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import {
  getOmiConversation,
  checkAnalysisStatus,
  isFullAnalysis,
  isAnalysisSkipped,
} from '@/features/conversations/services/conversations.service';
import type { OmiConversation } from '@/features/conversations/services/conversations.service';

export type AnalysisPhase = 'idle' | 'polling' | 'retrying' | 'completed' | 'failed';

export interface AnalysisState {
  conversationId: string;
  localId?: string;
  source: string | null;
  phase: AnalysisPhase;
  hasV4: boolean;
  hasMinuta: boolean;
  retryCount: number;
  error: string | null;
  durationSeconds: number;
}

/** Event dispatched whenever any tracked conversation's analysis state changes */
export const ANALYSIS_STATE_CHANGED = 'analysis-state-changed';
/** Event dispatched when analysis completes (for toast notifications) */
export const ANALYSIS_COMPLETED = 'analysis-completed';

function checkV4(conv: OmiConversation): boolean {
  return isFullAnalysis(conv.communication_feedback_v4) || isAnalysisSkipped(conv.communication_feedback_v4);
}

function checkMinuta(conv: OmiConversation): boolean {
  return !!conv.meeting_minutes_data;
}

const POLL_INTERVAL_MS = 20_000;
const MAX_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_KEY_PREFIX = 'analysis_active_';

interface MeetingSyncStatus {
  meeting_id: string;
  total_jobs: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
}

class AnalysisPollingServiceImpl {
  private started = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Map of tracking key -> tracking state */
  private tracked = new Map<string, AnalysisState>();
  /** Timestamp when polling started for each conversation */
  private pollingStartedAt = new Map<string, number>();
  /** Resolved Supabase ID for local conversations (key -> supabaseId) */
  private resolvedIds = new Map<string, string>();

  start() {
    if (this.started) return;
    this.started = true;
    logger.debug('[AnalysisPollingService] Started');

    this.restoreFromSession();

    window.addEventListener('finalize-completed', this.handleFinalizeCompleted);
    window.addEventListener('sync-status-changed', this.handleSyncStatusChanged);

    this.pollAll();
    this.pollIntervalId = setInterval(() => this.pollAll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (!this.started) return;
    this.started = false;

    window.removeEventListener('finalize-completed', this.handleFinalizeCompleted);
    window.removeEventListener('sync-status-changed', this.handleSyncStatusChanged);

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    this.pollingStartedAt.clear();

    logger.debug('[AnalysisPollingService] Stopped');
  }

  /**
   * Start tracking a conversation for analysis completion.
   * Called when user triggers re-analysis or recording finishes.
   */
  track(opts: {
    conversationId: string;
    localId?: string;
    source: string | null;
    durationSeconds?: number;
    initialHasV4?: boolean;
    initialHasMinuta?: boolean;
  }) {
    const key = this.trackingKey(opts.conversationId, opts.localId);

    const existing = this.tracked.get(key);
    if (existing && (existing.phase === 'polling' || existing.phase === 'retrying')) {
      logger.debug(`[AnalysisPollingService] Already tracking ${key}, skipping`);
      return;
    }

    const state: AnalysisState = {
      conversationId: opts.conversationId,
      localId: opts.localId,
      source: opts.source,
      phase: 'polling',
      hasV4: opts.initialHasV4 ?? false,
      hasMinuta: opts.initialHasMinuta ?? false,
      retryCount: 0,
      error: null,
      durationSeconds: opts.durationSeconds ?? 0,
    };

    this.tracked.set(key, state);
    this.pollingStartedAt.set(key, Date.now());
    this.persistToSession(state);
    this.emitStateChanged(key);
    logger.debug(`[AnalysisPollingService] Now tracking ${key} (source: ${opts.source})`);

    // For local conversations, immediately check if sync already completed
    // (handles race condition where track() is called after finalize-completed event was missed)
    if (opts.source === 'local' && opts.localId) {
      this.tryRecoverSupabaseId(key, state, opts.localId).catch(() => {});
    }
  }

  /** Stop tracking a conversation */
  untrack(conversationId: string, localId?: string) {
    const key = this.trackingKey(conversationId, localId);
    this.pollingStartedAt.delete(key);
    this.tracked.delete(key);
  }

  /** Get current state for a conversation (used by UI subscribers) */
  getState(conversationId: string, localId?: string): AnalysisState | null {
    const key = this.trackingKey(conversationId, localId);
    const state = this.tracked.get(key);
    if (state) return state;

    // Fallback: search across all tracked entries
    for (const s of this.tracked.values()) {
      if (s.conversationId === conversationId) return s;
      if (localId && s.localId === localId) return s;
      if (s.localId === conversationId) return s;
    }
    return null;
  }

  /** Check if any conversation is currently being analyzed */
  hasActiveAnalysis(): boolean {
    for (const s of this.tracked.values()) {
      if (s.phase === 'polling' || s.phase === 'retrying') return true;
    }
    return false;
  }

  /** Manual retry triggered by user clicking "Reintentar" */
  retryManually(conversationId: string, localId?: string) {
    const key = this.findKey(conversationId, localId);
    if (!key) return;
    const state = this.tracked.get(key);
    if (!state) return;

    state.retryCount += 1;
    state.error = null;
    state.phase = 'retrying';
    this.emitStateChanged(key);

    this.callFinalize(key).catch(() => {});
  }

  /** Restart polling (e.g., after user clicks re-analyze) */
  restartPolling(conversationId: string, localId?: string, source?: string | null) {
    const key = this.findKey(conversationId, localId) ?? this.trackingKey(conversationId, localId);
    const existing = this.tracked.get(key);

    if (existing) {
      existing.phase = 'polling';
      existing.hasV4 = false;
      existing.hasMinuta = false;
      existing.retryCount = 0;
      existing.error = null;
      if (source !== undefined) existing.source = source;
    } else {
      this.track({ conversationId, localId, source: source ?? null });
      return;
    }

    this.pollingStartedAt.set(key, Date.now());
    this.emitStateChanged(key);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private trackingKey(conversationId: string, localId?: string): string {
    return localId || conversationId;
  }

  private findKey(conversationId: string, localId?: string): string | null {
    const key = this.trackingKey(conversationId, localId);
    if (this.tracked.has(key)) return key;

    for (const [k, s] of this.tracked.entries()) {
      if (s.conversationId === conversationId) return k;
      if (localId && s.localId === localId) return k;
      if (s.localId === conversationId) return k;
    }
    return null;
  }

  private async pollAll() {
    if (!this.started) return;

    for (const [key, state] of this.tracked.entries()) {
      if (state.phase !== 'polling') continue;

      // Global timeout: 10 minutes
      const startedAt = this.pollingStartedAt.get(key) || 0;
      if (startedAt > 0 && Date.now() - startedAt > MAX_TOTAL_TIMEOUT_MS) {
        state.phase = 'failed';
        state.error = 'El análisis no se completó después de 10 minutos.';
        this.pollingStartedAt.delete(key);
        this.removeFromSession(key);
        this.emitStateChanged(key);
        continue;
      }

      // For local convs without a resolved Supabase ID: check sync queue status
      if (state.source === 'local' && !this.resolvedIds.has(key)) {
        await this.pollLocalSyncStatus(key, state);
        continue;
      }

      // Lightweight status check via analysis_status column
      const supabaseId = this.resolvedIds.get(key) || state.conversationId;
      try {
        const status = await checkAnalysisStatus(supabaseId);

        if (status === 'completed') {
          // Status confirms analysis is done — fetch full data once
          const conv = await getOmiConversation(supabaseId);
          if (conv) {
            this.handleConversationData(key, conv);
          }
        } else if (status === 'failed') {
          state.phase = 'failed';
          state.error = 'El análisis falló en el servidor. Intenta de nuevo.';
          this.pollingStartedAt.delete(key);
          this.removeFromSession(key);
          this.emitStateChanged(key);
        } else if (status === 'skipped') {
          // Fetch data to get the skip reason for the UI
          const conv = await getOmiConversation(supabaseId);
          if (conv) {
            this.handleConversationData(key, conv);
          }
        } else if (status === null) {
          // analysis_status not set yet — fallback to checking communication_feedback_v4
          // (backward compatibility: web app hasn't been updated to set analysis_status)
          const conv = await getOmiConversation(supabaseId);
          if (conv) {
            this.handleConversationData(key, conv);
          }
        }
        // 'pending' or 'processing' → keep waiting, do nothing
      } catch (err) {
        console.warn(`[AnalysisPollingService] Poll error for ${key}:`, err);
      }
    }
  }

  /** Check sync queue status for local conversations waiting to be synced */
  private async pollLocalSyncStatus(key: string, state: AnalysisState) {
    try {
      const meetingId = state.localId || state.conversationId;
      const syncStatus = await invoke<MeetingSyncStatus | null>('sync_queue_get_meeting_status', {
        meetingId,
      });

      if (!syncStatus) return; // No jobs found — waiting for enqueue

      // All jobs completed — recover supabaseId from finalize result
      // (self-healing path for when finalize-completed DOM event was missed)
      if (syncStatus.completed > 0 && syncStatus.pending === 0 && syncStatus.in_progress === 0 && syncStatus.failed === 0) {
        await this.tryRecoverSupabaseId(key, state, meetingId);
        return;
      }

      if (syncStatus.failed > 0 && syncStatus.pending === 0 && syncStatus.in_progress === 0) {
        // All remaining jobs have failed
        state.phase = 'failed';
        state.error = 'La sincronización con la nube falló. Intenta de nuevo.';
        this.pollingStartedAt.delete(key);
        this.removeFromSession(key);
        this.emitStateChanged(key);
      }
      // Otherwise: jobs still pending/in_progress, keep waiting for events
    } catch (err) {
      console.warn(`[AnalysisPollingService] Sync status check error for ${key}:`, err);
    }
  }

  /**
   * Recover Supabase conversation ID from a completed finalize job's result_data.
   * This is the self-healing path for when the finalize-completed DOM event was missed
   * due to a race condition (event fired before track() was called).
   */
  private async tryRecoverSupabaseId(key: string, state: AnalysisState, meetingId: string) {
    try {
      const resultData = await invoke<string | null>('sync_queue_get_finalize_result', { meetingId });
      if (!resultData) return;

      const parsed = JSON.parse(resultData);
      const supabaseId = parsed.conversation_id;
      if (!supabaseId) return;

      logger.debug(`[AnalysisPollingService] Recovered supabaseId=${supabaseId} for ${key} from sync_queue`);

      // Same logic as handleFinalizeCompleted: store resolved ID and start cloud polling
      this.resolvedIds.set(key, supabaseId);
      state.conversationId = supabaseId;
      if (state.source === 'local') {
        state.source = 'maity_desktop';
      }

      // Immediately check status after recovering ID
      try {
        const status = await checkAnalysisStatus(supabaseId);
        if (status === 'completed' || status === 'skipped' || status === null) {
          // Fetch full data for completed/skipped/unknown
          const conv = await getOmiConversation(supabaseId);
          if (conv) {
            this.handleConversationData(key, conv);
          }
        } else if (status === 'failed') {
          state.phase = 'failed';
          state.error = 'El análisis falló en el servidor. Intenta de nuevo.';
          this.pollingStartedAt.delete(key);
          this.removeFromSession(key);
          this.emitStateChanged(key);
        }
        // 'pending'/'processing' → will be picked up by next poll cycle
      } catch (err) {
        console.warn(`[AnalysisPollingService] Error checking status after recovery:`, err);
      }
    } catch (err) {
      console.warn(`[AnalysisPollingService] Failed to recover supabaseId for ${key}:`, err);
    }
  }

  private handleConversationData(key: string, conv: OmiConversation) {
    const state = this.tracked.get(key);
    if (!state) return;

    const hasV4 = checkV4(conv);
    const hasMinuta = checkMinuta(conv);
    const changed = hasV4 !== state.hasV4 || hasMinuta !== state.hasMinuta;

    state.hasV4 = hasV4;
    state.hasMinuta = hasMinuta;

    if (hasV4 && hasMinuta) {
      state.phase = 'completed';
      this.pollingStartedAt.delete(key);
      this.removeFromSession(key);

      window.dispatchEvent(new CustomEvent(ANALYSIS_COMPLETED, {
        detail: {
          conversationId: state.conversationId,
          localId: state.localId,
          title: conv.title,
        },
      }));
    }

    if (changed) {
      // Dispatch with updated conversation data for UI subscribers
      window.dispatchEvent(new CustomEvent(ANALYSIS_STATE_CHANGED, {
        detail: { key, state: { ...state }, conversation: conv },
      }));
    } else {
      this.emitStateChanged(key);
    }
  }

  /** Manual retry: re-trigger finalize and resume polling */
  private async callFinalize(key: string) {
    const state = this.tracked.get(key);
    if (!state) return;

    const supabaseId = this.resolvedIds.get(key) || state.conversationId;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Sin sesion activa');
      }

      const result = await invoke<{ ok: boolean; error?: string }>('finalize_conversation_cloud', {
        conversationId: supabaseId,
        durationSeconds: state.durationSeconds,
        accessToken: session.access_token,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Finalize returned ok=false');
      }

      // Resume polling
      state.phase = 'polling';
      this.pollingStartedAt.set(key, Date.now());
      this.persistToSession(state);
      this.emitStateChanged(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AnalysisPollingService] Retry failed for ${key}:`, msg);
      state.phase = 'failed';
      state.error = msg;
      this.pollingStartedAt.delete(key);
      this.removeFromSession(key);
      this.emitStateChanged(key);
    }
  }

  // ── Event handlers from CloudSyncWorker ──────────────────────────

  private handleFinalizeCompleted = async (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail?.conversationId) return;

    const { conversationId: supabaseId, meetingId } = detail;

    // Find the tracked conversation
    let key: string | null = null;
    for (const [k, s] of this.tracked.entries()) {
      if (s.localId === meetingId || s.conversationId === meetingId) {
        key = k;
        break;
      }
      if (s.conversationId === supabaseId) {
        key = k;
        break;
      }
    }

    if (!key) return;

    const state = this.tracked.get(key);
    if (!state) return;

    logger.debug(`[AnalysisPollingService] finalize-completed for ${key}, supabaseId=${supabaseId}`);

    // Store resolved Supabase ID so cloud polling can begin
    this.resolvedIds.set(key, supabaseId);
    state.conversationId = supabaseId;

    if (state.source === 'local') {
      state.source = 'maity_desktop';
    }

    // Immediately check status
    try {
      const status = await checkAnalysisStatus(supabaseId);
      if (status === 'completed' || status === 'skipped' || status === null) {
        const conv = await getOmiConversation(supabaseId);
        if (conv) {
          this.handleConversationData(key, conv);
        }
      } else if (status === 'failed') {
        state.phase = 'failed';
        state.error = 'El análisis falló en el servidor. Intenta de nuevo.';
        this.pollingStartedAt.delete(key);
        this.removeFromSession(key);
        this.emitStateChanged(key);
      }
      // 'pending'/'processing' → will be picked up by poll cycle
    } catch (err) {
      console.warn(`[AnalysisPollingService] Error checking status after finalize:`, err);
    }
  };

  private handleSyncStatusChanged = async (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail?.meetingId || detail.status !== 'completed') return;

    if (detail.jobType === 'save_conversation') {
      for (const [, s] of this.tracked.entries()) {
        if (s.localId === detail.meetingId || s.conversationId === detail.meetingId) {
          logger.debug(`[AnalysisPollingService] sync-status-changed: ${detail.jobType} completed for ${detail.meetingId}`);
          break;
        }
      }
    }
  };

  // ── Utilities ────────────────────────────────────────────────────

  private emitStateChanged(key: string) {
    const state = this.tracked.get(key);
    if (!state) return;
    window.dispatchEvent(new CustomEvent(ANALYSIS_STATE_CHANGED, {
      detail: { key, state: { ...state } },
    }));
  }

  // ── Session persistence (survives page reloads in dev) ──────────

  private persistToSession(state: AnalysisState) {
    try {
      const key = state.localId || state.conversationId;
      sessionStorage.setItem(
        `${SESSION_KEY_PREFIX}${key}`,
        JSON.stringify({ ...state, _savedAt: Date.now() })
      );
    } catch { /* ignore */ }
  }

  private removeFromSession(key: string) {
    try {
      sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${key}`);
    } catch { /* ignore */ }
  }

  private restoreFromSession() {
    try {
      const now = Date.now();
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const storageKey = sessionStorage.key(i);
        if (!storageKey?.startsWith(SESSION_KEY_PREFIX)) continue;

        const raw = sessionStorage.getItem(storageKey);
        if (!raw) continue;

        try {
          const saved = JSON.parse(raw);
          const savedAt = saved._savedAt || 0;
          // Skip entries older than 10 minutes
          if (now - savedAt > MAX_TOTAL_TIMEOUT_MS) {
            sessionStorage.removeItem(storageKey);
            continue;
          }
          // Only restore active entries
          if (saved.phase === 'polling' || saved.phase === 'retrying') {
            const key = storageKey.replace(SESSION_KEY_PREFIX, '');
            const state: AnalysisState = {
              conversationId: saved.conversationId,
              localId: saved.localId,
              source: saved.source,
              phase: 'polling', // Always resume as polling
              hasV4: saved.hasV4 || false,
              hasMinuta: saved.hasMinuta || false,
              retryCount: saved.retryCount || 0,
              error: null,
              durationSeconds: saved.durationSeconds || 0,
            };
            this.tracked.set(key, state);
            this.pollingStartedAt.set(key, Date.now());
            logger.debug(`[AnalysisPollingService] Restored from session: ${key}`);
          } else {
            sessionStorage.removeItem(storageKey);
          }
        } catch {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch { /* ignore */ }
  }
}

/** Singleton instance */
export const analysisPollingService = new AnalysisPollingServiceImpl();
