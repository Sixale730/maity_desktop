/**
 * Adapter de `@/features/omi/utils/feedback-scores` (web Sixale730/maity@3ef2914)
 * para el dashboard de expedición portado (resuelve por alias en tsconfig/vitest).
 *
 * - `isLowConfidenceV4`: el desktop ya tiene el MISMO predicado (#147) en
 *   `features/conversations/utils/scoring.ts`; se re-exporta, no se duplica.
 * - `getNormalizedScores`: copia de la web. Adaptaciones mínimas: el adapter V4
 *   del desktop vive en `features/conversations/components/analysis/dashboard-v1/adapter`,
 *   y el `CommunicationFeedback` (V1) del desktop no declara `claridad`/`estructura`
 *   (la web sí), así que el fallback V1 lee esos dos campos sin tipar.
 *   Un análisis marcado como omitido (`AnalysisSkipped`) no tiene componentes →
 *   devuelve `null` y cae al V1 igual que en la web.
 */
import type { OmiConversationListItem } from './omi.service';
import { cloudV4ToDashboardV1 } from '@/features/conversations/components/analysis/dashboard-v1/adapter';
import { isLowConfidenceV4 } from '@/features/conversations/utils/scoring';

export { isLowConfidenceV4 };

/** Unified scores, all on a 0–100 scale (muletillas_total is a raw count). */
export interface NormalizedScores {
  overall: number;
  claridad: number;
  estructura: number;
  vocabulario: number;
  empatia: number;
  objetivo: number;
  adaptacion: number;
  muletillas_total: number;
  /** Short human-readable insight, version-agnostic (V4 resumen / V1 feedback). */
  summary?: string;
}

export function getNormalizedScores(conv: OmiConversationListItem): NormalizedScores | null {
  // Prefer V4 (current standard) — already 0–100.
  if (conv.communication_feedback_v4 && !isLowConfidenceV4(conv.communication_feedback_v4)) {
    const v4 = cloudV4ToDashboardV1(conv.communication_feedback_v4);
    const c = v4.calidad_global?.componentes;
    const overall = v4.calidad_global?.puntaje ?? 0;
    const hasData = !!c && (overall > 0 || Object.values(c).some((n) => (n ?? 0) > 0));
    if (c && hasData) {
      return {
        overall,
        // V4 dimension names → V1/radar dimension names.
        claridad: c.claridad ?? 0,
        estructura: c.estructura ?? 0,
        vocabulario: c.persuasion ?? 0,
        empatia: c.empatia ?? 0,
        objetivo: c.proposito ?? 0,
        adaptacion: c.adaptacion ?? 0,
        muletillas_total: v4.radiografia?.muletillas_total ?? 0,
        summary: v4.resumen?.bullets?.[0] ?? v4.resumen?.descripcion,
      };
    }
  }

  // Fallback: V1 (deprecated) — flat fields on a 0–10 scale, scaled up to 0–100.
  const fb = conv.communication_feedback;
  if (fb?.overall_score != null) {
    const legacy = fb as typeof fb & { claridad?: number; estructura?: number };
    const s = (v?: number) => Math.round((v ?? 0) * 10);
    return {
      overall: s(fb.overall_score),
      claridad: s(legacy.claridad),
      estructura: s(legacy.estructura),
      vocabulario: s(fb.vocabulario),
      empatia: s(fb.empatia),
      objetivo: s(fb.objetivo),
      adaptacion: s(fb.adaptacion),
      muletillas_total: fb.radiografia?.muletillas_total ?? 0,
      summary: fb.feedback ?? fb.summary ?? fb.strengths?.[0],
    };
  }

  return null;
}
