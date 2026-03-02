import { useMemo } from 'react';
import type { OmiConversation, CommunicationFeedback } from '@/features/conversations/services/conversations.service';

// ============================================================================
// Types
// ============================================================================

export interface TrendDataPoint {
  fecha: string;
  claridad: number;
  estructura: number;
  vocabulario: number;
  empatia: number;
  objetivo: number;
  adaptacion: number;
  muletillas_min: number;
}

export interface DimensionSummaryItem {
  key: string;
  label: string;
  current: number;
  delta: number;
}

export interface RadarDataPoint {
  dim: string;
  s1: number;
  s6: number;
  auto?: number;
}

export interface SessionHistoryRow {
  num: number;
  fecha: string;
  tipo: string;
  global: number;
  claridad: number;
  estructura: number;
  empatia: number;
  objetivo: number;
  muletillas: number;
}

export interface ProgressChartsData {
  trendData: TrendDataPoint[];
  dimensionSummary: DimensionSummaryItem[];
  radarData: RadarDataPoint[];
  fillerWordsInsight: string;
  radarInsight: string;
  sessionHistory: SessionHistoryRow[];
  loading: boolean;
  hasData: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

const DIMS = ['claridad', 'estructura', 'vocabulario', 'empatia', 'objetivo', 'adaptacion'] as const;

const DIM_LABELS: Record<string, string> = {
  claridad: 'Claridad',
  estructura: 'Estructura',
  vocabulario: 'Vocabulario',
  empatia: 'Empatía',
  objetivo: 'Objetivo',
  adaptacion: 'Adaptación',
};

function safeScore(val: number | null | undefined): number {
  return Math.round((val ?? 0) * 10);
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// Desktop has mixed English/Spanish field names — map to canonical Spanish
function getDimValue(fb: CommunicationFeedback, dim: string): number | undefined {
  switch (dim) {
    case 'claridad': return (fb as Record<string, unknown>).claridad as number ?? fb.clarity;
    case 'estructura': return (fb as Record<string, unknown>).estructura as number ?? fb.structure;
    case 'vocabulario': return fb.vocabulario;
    case 'empatia': return fb.empatia;
    case 'objetivo': return fb.objetivo;
    case 'adaptacion': return fb.adaptacion;
    default: return undefined;
  }
}

function getFillerRate(conv: OmiConversation): number {
  const muletillasTotal = conv.communication_feedback?.radiografia?.muletillas_total ?? 0;
  const durationMin = (conv.duration_seconds || 0) / 60;
  if (durationMin <= 0) return 0;
  return Math.round((muletillasTotal / durationMin) * 10) / 10;
}

type FeedbackConversation = OmiConversation & { communication_feedback: NonNullable<OmiConversation['communication_feedback']> };

function buildTrendData(convs: FeedbackConversation[]): TrendDataPoint[] {
  return convs.map((conv) => {
    const fb = conv.communication_feedback;
    return {
      fecha: formatShortDate(conv.created_at),
      claridad: safeScore(getDimValue(fb, 'claridad')),
      estructura: safeScore(getDimValue(fb, 'estructura')),
      vocabulario: safeScore(getDimValue(fb, 'vocabulario')),
      empatia: safeScore(getDimValue(fb, 'empatia')),
      objetivo: safeScore(getDimValue(fb, 'objetivo')),
      adaptacion: safeScore(getDimValue(fb, 'adaptacion')),
      muletillas_min: getFillerRate(conv),
    };
  });
}

function buildDimensionSummary(first: FeedbackConversation, last: FeedbackConversation): DimensionSummaryItem[] {
  return DIMS.map((key) => {
    const current = safeScore(getDimValue(last.communication_feedback, key));
    const initial = safeScore(getDimValue(first.communication_feedback, key));
    return {
      key,
      label: DIM_LABELS[key],
      current,
      delta: current - initial,
    };
  });
}

function buildRadarData(first: FeedbackConversation, last: FeedbackConversation): RadarDataPoint[] {
  return DIMS.map((key) => ({
    dim: DIM_LABELS[key],
    s1: safeScore(getDimValue(first.communication_feedback, key)),
    s6: safeScore(getDimValue(last.communication_feedback, key)),
  }));
}

function buildFillerWordsInsight(convs: FeedbackConversation[]): string {
  if (convs.length === 0) return '';

  const rateFirst = getFillerRate(convs[0]);
  const rateLast = getFillerRate(convs[convs.length - 1]);

  if (rateFirst === 0 && rateLast === 0) return 'Sin datos de muletillas aún.';

  if (convs.length === 1) {
    return `Tasa actual: ${rateLast.toFixed(1)}/min. Meta: <1.5/min (nivel profesional).`;
  }

  const change = rateFirst > 0
    ? Math.round(((rateFirst - rateLast) / rateFirst) * 100)
    : 0;

  if (change > 0) {
    return `De ${rateFirst.toFixed(1)} a ${rateLast.toFixed(1)}/min — ${change}% de reducción. Meta: <1.5/min (nivel profesional).`;
  }
  if (change < 0) {
    return `De ${rateFirst.toFixed(1)} a ${rateLast.toFixed(1)}/min — incremento de ${Math.abs(change)}%. Meta: <1.5/min.`;
  }
  return `Estable en ${rateLast.toFixed(1)}/min. Meta: <1.5/min (nivel profesional).`;
}

function buildRadarInsight(radar: RadarDataPoint[]): string {
  if (radar.length === 0) return '';
  const improved = radar.filter(r => r.s6 > r.s1);
  const declined = radar.filter(r => r.s6 < r.s1);
  const biggest = [...radar].sort((a, b) => (b.s6 - b.s1) - (a.s6 - a.s1))[0];

  if (improved.length === 0 && declined.length === 0) {
    return 'Sin cambios entre la primera y última evaluación.';
  }

  const parts: string[] = [];
  if (improved.length > 0) {
    parts.push(`Mejora en ${improved.map(r => r.dim.toLowerCase()).join(', ')}`);
  }
  if (biggest && biggest.s6 > biggest.s1) {
    parts.push(`mayor expansión en ${biggest.dim.toLowerCase()} (+${biggest.s6 - biggest.s1})`);
  }
  if (declined.length > 0) {
    parts.push(`atención en ${declined.map(r => r.dim.toLowerCase()).join(', ')}`);
  }
  return parts.join('. ') + '.';
}

function buildSessionHistory(conversations: OmiConversation[]): SessionHistoryRow[] {
  return conversations
    .filter(c => c.communication_feedback?.overall_score != null)
    .slice(0, 5)
    .map((conv, i) => {
      const fb = conv.communication_feedback!;
      const durationMin = (conv.duration_seconds || 0) / 60;
      const muletillas = fb.radiografia
        ? (durationMin > 0 ? Math.round((fb.radiografia.muletillas_total! / durationMin) * 10) / 10 : 0)
        : 0;
      const date = new Date(conv.created_at);

      return {
        num: i + 1,
        fecha: date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        tipo: conv.category || 'Conversación',
        global: Math.round((fb.overall_score ?? 0) * 10),
        claridad: safeScore(getDimValue(fb, 'claridad')),
        estructura: safeScore(getDimValue(fb, 'estructura')),
        empatia: safeScore(getDimValue(fb, 'empatia')),
        objetivo: safeScore(getDimValue(fb, 'objetivo')),
        muletillas,
      };
    });
}

// ============================================================================
// Hook
// ============================================================================

export function useProgressChartsData(conversations: OmiConversation[]): ProgressChartsData {
  return useMemo(() => {
    const withFeedback = conversations
      .filter((c): c is FeedbackConversation =>
        c.communication_feedback?.overall_score != null
      )
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (withFeedback.length === 0) {
      return {
        trendData: [],
        dimensionSummary: [],
        radarData: [],
        fillerWordsInsight: '',
        radarInsight: '',
        sessionHistory: [],
        loading: false,
        hasData: false,
      };
    }

    const first = withFeedback[0];
    const last = withFeedback[withFeedback.length - 1];

    const trendData = buildTrendData(withFeedback);
    const dimensionSummary = buildDimensionSummary(first, last);
    const radarData = buildRadarData(first, last);
    const fillerWordsInsight = buildFillerWordsInsight(withFeedback);
    const radarInsight = buildRadarInsight(radarData);
    const sessionHistory = buildSessionHistory(conversations);

    return {
      trendData,
      dimensionSummary,
      radarData,
      fillerWordsInsight,
      radarInsight,
      sessionHistory,
      loading: false,
      hasData: true,
    };
  }, [conversations]);
}
