/* eslint-disable no-restricted-syntax -- Text-only V1/V4 adapter: normalized numeric scores do not expose citations or recommendations. No score calculations here. */
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/conversation-moments.ts
// Adaptaciones desktop: @/features/omi/* resuelve a los adapters del desktop por alias (features/dashboard/adapters, dashboard-v1/adapter).
import type { OmiConversationListItem, OmiTranscriptSegment } from '@/features/omi/services/omi.service';
import { cloudV4ToDashboardV1, DIM_KEYS } from '@/features/omi/components/analysis/dashboard-v1/adapter';
import { isLowConfidenceV4 } from '@/features/omi/utils/feedback-scores';

export interface ConversationMoment {
  title: string;
  explanation?: string;
  suggestion?: string;
  evidence?: { quote: string; context: string; seconds?: number };
}

const clean = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const dimensionKey = (label?: string) => DIM_KEYS.find(key => clean(key) === clean(label ?? ''));
const DIMENSION_LABELS = { claridad: 'Claridad', estructura: 'Estructura', persuasion: 'Persuasión', proposito: 'Propósito', empatia: 'Empatía', adaptacion: 'Adaptación' };

export function canVerifyMomentEvidence(conversation: OmiConversationListItem) {
  return !!conversation.communication_feedback_v4 && !isLowConfidenceV4(conversation.communication_feedback_v4);
}

export function latestAnalyzedConversation(conversations: OmiConversationListItem[]) {
  return conversations.filter(c => c.communication_feedback_v4 || c.communication_feedback)
    .slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** Match only identified user turns from this conversation; never invent audio offsets. */
export function verifiedEvidence(quote: string | undefined, segments: OmiTranscriptSegment[], conversationId: string) {
  if (!quote || clean(quote).length < 12) return undefined;
  const needle = clean(quote);
  const segment = segments.find(s => s.conversation_id === conversationId && s.is_user === true && clean(s.text).includes(needle));
  if (!segment) return undefined;
  return {
    quote,
    context: segment.text,
    ...(Number.isFinite(segment.start_time) && segment.start_time >= 0 ? { seconds: segment.start_time } : {}),
  };
}

export function buildConversationMoments(conversation: OmiConversationListItem, segments: OmiTranscriptSegment[]) {
  const raw = conversation.communication_feedback_v4;
  if (isLowConfidenceV4(raw)) return { unavailable: true };
  if (!raw) {
    const legacy = conversation.communication_feedback;
    return {
      strength: legacy?.strengths?.[0] ? { title: 'Lo que funcionó', explanation: legacy.strengths[0] } : undefined,
      improvement: legacy?.areas_to_improve?.[0] ? { title: 'Tu siguiente ajuste', explanation: legacy.areas_to_improve[0] } : undefined,
    };
  }
  const feedback = cloudV4ToDashboardV1(raw);
  const excluded = feedback.calidad_global?.no_aplica ?? [];
  function fromDimension(label?: string, hint?: string): ConversationMoment | undefined {
    if (!label && !hint) return undefined;
    const key = dimensionKey(label);
    if (key && excluded.includes(key)) return undefined;
    const detail = key ? feedback.dimensiones?.[key] : undefined;
    return {
      title: key ? DIMENSION_LABELS[key] : label || 'Tu comunicación',
      explanation: hint || detail?.que_significa,
      evidence: verifiedEvidence(detail?.cita, segments, conversation.id),
      suggestion: detail?.prueba_esto,
    };
  }
  const strength = fromDimension(feedback.resumen?.fortaleza, feedback.resumen?.fortaleza_hint);
  let improvement = fromDimension(feedback.resumen?.mejorar, feedback.resumen?.mejorar_hint);
  // A verified recommendation can stand on its own when no summary dimension is supplied.
  if (!improvement && !feedback.resumen?.mejorar) {
    for (const recommendation of feedback.recomendaciones ?? []) {
      const evidence = verifiedEvidence(recommendation.texto_original, segments, conversation.id);
      if (evidence && recommendation.texto_mejorado) {
        improvement = { title: recommendation.titulo, explanation: recommendation.descripcion, evidence, suggestion: recommendation.texto_mejorado };
        break;
      }
    }
  }
  return { strength, improvement };
}
