import type { OmiConversation } from '../services/conversations.service';
import { isAnalysisSkipped, isFullAnalysis } from '../services/conversations.service';

export type AnalysisPhase =
  | 'idle'
  | 'polling'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'stalled';

/** Hard timeout: if `finished_at` is older than this and analysis is not terminal, surface 'stalled'. */
export const STALL_TIMEOUT_MS = 6 * 60 * 1000;

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
 *   stalled (status non-terminal AND age > STALL_TIMEOUT_MS)
 *   polling (status non-terminal AND age <= STALL_TIMEOUT_MS, includes null status)
 *   idle (no finished_at, no status)
 */
export function derivePhase(conv: OmiConversation, nowMs: number = Date.now()): AnalysisPhase {
  const v4 = conv.communication_feedback_v4;
  const minuta = conv.meeting_minutes_data;
  const status = conv.analysis_status ?? null;

  // Strongest signal: data is fully present. Trust the data over a stale status flag
  // (covers the 'failed-but-data-present' inconsistency observed in production).
  if (isFullAnalysis(v4) && minuta != null) return 'completed';

  // Skipped marker is also data, treat as terminal.
  if (isAnalysisSkipped(v4)) return 'skipped';

  // Backend-assigned terminal states (only after data check).
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';

  // Non-terminal: pending, processing, or null. Distinguish polling from stalled by age.
  const finishedAtIso = conv.finished_at ?? conv.started_at ?? conv.created_at;
  if (!finishedAtIso) return 'idle';

  const finishedAtMs = Date.parse(finishedAtIso);
  if (Number.isNaN(finishedAtMs)) return 'polling';

  const ageMs = nowMs - finishedAtMs;
  if (ageMs > STALL_TIMEOUT_MS) return 'stalled';

  return 'polling';
}

/** Convenience: terminal phases never transition again on their own. */
export function isTerminalPhase(phase: AnalysisPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'skipped';
}
