import type { OmiConversation } from '../services/conversations.service';
import { isAnalysisSkipped, isFullAnalysis } from '../services/conversations.service';

export type AnalysisPhase =
  | 'idle'
  | 'polling'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'quota_skipped'
  | 'stalled';

/**
 * Stall thresholds:
 *   PROCESSING: 3 min when backend heartbeat is active (every 30s). 6 missed heartbeats = dead.
 *   LEGACY: 10 min for non-terminal rows without an explicit 'processing' status or heartbeat.
 */
export const STALL_TIMEOUT_PROCESSING_MS = 3 * 60 * 1000;
export const STALL_TIMEOUT_LEGACY_MS = 10 * 60 * 1000;
/** @deprecated Use STALL_TIMEOUT_LEGACY_MS or STALL_TIMEOUT_PROCESSING_MS. Kept for callers that still import. */
export const STALL_TIMEOUT_MS = STALL_TIMEOUT_LEGACY_MS;

/**
 * Derive the user-facing analysis phase from the conversation's authoritative state in DB.
 *
 * Pure function: identical inputs produce identical outputs. The `nowMs` parameter exists
 * so callers (and tests) can inject deterministic time without mocking `Date.now()`.
 *
 * Truth table priority:
 *   completed (data present)  > completed (status flag)
 *   skipped (data marker)     > skipped (status flag)
 *   failed (status flag)
 *   stalled (status='processing' AND updated_at older than PROCESSING threshold = backend heartbeat dead)
 *   stalled (no status, fallback: finished_at older than LEGACY threshold)
 *   polling (otherwise non-terminal)
 *   idle (no anchor timestamp, no status)
 */
export function derivePhase(conv: OmiConversation, nowMs: number = Date.now()): AnalysisPhase {
  const status = conv.analysis_status ?? null;

  // Issue #05 fase 2: la proyección ligera de la lista (`_projection==='list'`)
  // trae `communication_feedback_v4`/`meeting_minutes_data` en `null` a
  // propósito (son 2 de los 5 campos pesados que el query ya no baja) — sobre
  // ellos `isFullAnalysis`/`isAnalysisSkipped` SIEMPRE darían falso. Sin este
  // branch, TODA fila proyectada caería al fallback por edad de abajo →
  // 'stalled' → dispara `reanalyzeConversation` automáticamente y le quema
  // cuota de análisis al usuario (y reenciende el poll de 15s que la fase 1
  // apagó, porque ConversationsList ata su `refetchInterval` a esta función).
  // Los `_list*` ya traen la señal resuelta EN el query — nada de JSONB aquí.
  const isProjected = conv._projection === 'list';
  const isFull = isProjected
    ? conv._listAnalysis === 'full'
    : isFullAnalysis(conv.communication_feedback_v4);
  const isSkipped = isProjected
    ? conv._listAnalysis === 'skipped'
    : isAnalysisSkipped(conv.communication_feedback_v4);
  const hasMinuta = isProjected
    ? !!conv._listHasMinuta
    : conv.meeting_minutes_data != null;

  // Strongest signal: data is fully present. Trust the data over a stale status flag
  // (covers the 'failed-but-data-present' inconsistency observed in production).
  if (isFull && hasMinuta) return 'completed';

  // Skipped marker is also data, treat as terminal.
  if (isSkipped) return 'skipped';

  // Backend-assigned terminal states (only after data check).
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  // Cuota del plan agotada: terminal. Sin esta rama la fila caería al fallback
  // por edad → 'stalled' → auto-retries + watchdog reload en loop.
  if (status === 'quota_skipped') return 'quota_skipped';
  if (status === 'failed') return 'failed';

  // status='processing' with heartbeat: updated_at is the liveness signal.
  // Backend writes updated_at every 30s while the LLM call is in flight.
  if (status === 'processing' && conv.updated_at) {
    const lastHeartbeatMs = Date.parse(conv.updated_at);
    if (!Number.isNaN(lastHeartbeatMs)) {
      const sinceLastHeartbeat = nowMs - lastHeartbeatMs;
      if (sinceLastHeartbeat > STALL_TIMEOUT_PROCESSING_MS) return 'stalled';
      return 'polling';
    }
  }

  // Fallback (status=null, status='pending', or processing without updated_at):
  // legacy age-based detection from finished_at/started_at/created_at.
  const finishedAtIso = conv.finished_at ?? conv.started_at ?? conv.created_at;
  if (!finishedAtIso) return 'idle';

  const finishedAtMs = Date.parse(finishedAtIso);
  if (Number.isNaN(finishedAtMs)) return 'polling';

  const ageMs = nowMs - finishedAtMs;
  if (ageMs > STALL_TIMEOUT_LEGACY_MS) return 'stalled';

  return 'polling';
}

/** Convenience: terminal phases never transition again on their own. */
export function isTerminalPhase(phase: AnalysisPhase): boolean {
  return (
    phase === 'completed' ||
    phase === 'failed' ||
    phase === 'skipped' ||
    phase === 'quota_skipped'
  );
}
