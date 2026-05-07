import type { OmiConversation } from '../services/conversations.service';

/**
 * Coalesce a 0-100 communication score from any of the supported analysis schemas.
 *
 * Priority:
 *   1. V4 `calidad_global.puntaje` (0-100) — canonical path of the new analysis
 *   2. V4 `resumen.puntuacion_global` (0-100) — alternative schema
 *   3. V4 `calidad_global` as a bare number (defensive)
 *   4. Legacy `overall_score` (0-10) ×10
 *   5. `null` for AnalysisSkipped or no score available
 */
export function getCommScore(conv: OmiConversation): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v4 = conv.communication_feedback_v4 as any;

  if (v4 && (v4.status === 'skipped' || v4.skipped === true)) {
    return null;
  }

  const cg = v4?.calidad_global;
  if (cg && typeof cg === 'object' && typeof cg.puntaje === 'number') {
    return cg.puntaje;
  }

  if (v4?.resumen && typeof v4.resumen.puntuacion_global === 'number') {
    return v4.resumen.puntuacion_global;
  }

  if (typeof cg === 'number') {
    return cg;
  }

  if (conv.communication_feedback?.overall_score != null) {
    return conv.communication_feedback.overall_score * 10;
  }

  return null;
}
