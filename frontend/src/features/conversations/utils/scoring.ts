import { isAnalysisSkipped, type OmiConversation } from '../services/conversations.service';

/**
 * #147: un V4 cuyo insumo se juzgó de baja confianza (ruido transcrito, o el
 * modelo tuvo que adivinar quién dijo qué en un `usuario:` plano) conserva su
 * puntaje en el detalle CON aviso, pero no debe mover el radar, la tendencia
 * ni el historial. Mismo predicado que `maity.team_conversation_scores` (SQL)
 * y `isLowConfidenceV4` de la web; NULL-safe: las filas anteriores al 21-ago-2026
 * no traen `calidad_insumo` y cuentan normal.
 */
export function isLowConfidenceV4(v4: unknown): boolean {
  if (!v4 || typeof v4 !== 'object') return false;
  const calidad = (v4 as Record<string, unknown>).calidad_insumo;
  return !!calidad && typeof calidad === 'object' && (calidad as Record<string, unknown>).nivel === 'baja';
}

/**
 * Coalesce a 0-100 communication score from any of the supported analysis schemas.
 *
 * Priority:
 *   1. `null` for AnalysisSkipped or `calidad_insumo.nivel === 'baja'` (#73)
 *   2. V4 `calidad_global.puntaje` (0-100) — canonical path of the new analysis
 *   3. V4 `resumen.puntuacion_global` (0-100) — alternative schema
 *   4. V4 `calidad_global` as a bare number (defensive)
 *   5. Legacy `overall_score` (0-10) ×10
 *   6. `null` when no score is available
 *
 * Todo agregado (historial, sparkline, promedios) DEBE pasar por aquí para que
 * la exclusión de filas no evaluables/baja confianza no se re-implemente por
 * consumidor.
 */
export function getCommScore(conv: OmiConversation): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v4 = conv.communication_feedback_v4 as any;

  if (v4 && (isAnalysisSkipped(v4) || v4.skipped === true)) {
    return null;
  }

  if (isLowConfidenceV4(v4)) {
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
