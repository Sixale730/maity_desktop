'use client';

import { Card } from '@/components/ui/card';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart as RechartsRadar, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';
import type { OmiConversation, FormResponse } from '@/features/conversations/services/conversations.service';
import {
  useProgressChartsData,
  type TrendDataPoint,
  type DimensionSummaryItem,
  type RadarDataPoint,
  type SessionHistoryRow,
} from '../hooks/useProgressChartsData';

// ============================================================================
// SHARED CHART CONFIG
// ============================================================================

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: '#141418', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#a0a0b0' },
  itemStyle: { color: '#fff' },
};

const AXIS_STYLE = { fontSize: 10, fill: '#6b7280' };
const GRID_STYLE = { stroke: '#1a1a2e', strokeDasharray: '3 3' };

const DIM_COLORS: Record<string, string> = {
  claridad: '#485df4', estructura: '#ff8c42', vocabulario: '#3b82f6',
  empatia: '#ef4444', objetivo: '#ffd93d', adaptacion: '#1bea9a',
};

// ============================================================================
// DIMENSION TREND CHART
// ============================================================================

function DimensionTrendChart({ data, summary }: { data: TrendDataPoint[]; summary: DimensionSummaryItem[] }) {
  return (
    <Card className="p-5 bg-[#0F0F0F] border border-white/10">
      <h3 className="font-bold text-white mb-1">Tendencia por Dimensión</h3>
      <p className="text-xs text-gray-500 mb-4">Las que suben son mejoras; las planas necesitan intervención.</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="fecha" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconType="circle" iconSize={8} />
          {Object.entries(DIM_COLORS).map(([key, color]) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key.charAt(0).toUpperCase() + key.slice(1)}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {summary.length > 0 && (
        <div className="mt-4 flex gap-2">
          {summary.map((dim) => {
            const color = DIM_COLORS[dim.key];
            return (
              <div key={dim.key} className="text-center p-2 rounded-lg bg-[#141418] flex-1 min-w-0">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{dim.label}</span>
                </div>
                <div className="text-lg font-extrabold text-white">{dim.current}</div>
                <div className={`text-[10px] ${dim.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {dim.delta >= 0 ? '+' : ''}{dim.delta}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// RADAR COMPARISON
// ============================================================================

function RadarComparisonChart({ data, insight }: { data: RadarDataPoint[]; insight: string }) {
  return (
    <Card className="p-5 bg-[#0F0F0F] border border-white/10">
      <h3 className="font-bold text-white mb-1">Radar: Evaluación IA vs Autoevaluación</h3>
      <p className="text-xs text-gray-500 mb-4">El área verde debería ser más grande que la roja.</p>
      <ResponsiveContainer width="100%" height={280}>
        <RechartsRadar cx="50%" cy="50%" outerRadius="75%" data={data}>
          <PolarGrid stroke="#1a1a2e" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: '#a0a0b0' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#4a4a5a' }} axisLine={false} />
          <Radar name="Primera" dataKey="s1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
          <Radar name="Última" dataKey="s6" stroke="#1bea9a" fill="#1bea9a" fillOpacity={0.15} strokeWidth={2} dot={{ r: 3, fill: '#1bea9a' }} />
          {data.some(d => d.auto != null && d.auto > 0) && (
            <Radar name="Autoevaluación" dataKey="auto" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.10} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#f59e0b' }} />
          )}
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconType="circle" iconSize={8} />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
        </RechartsRadar>
      </ResponsiveContainer>
      {insight && (
        <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-gray-400 leading-relaxed">
          <strong className="text-gray-300">Lectura:</strong> {insight}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// FILLER WORDS TREND
// ============================================================================

function FillerWordsTrendChart({ data, insight }: { data: TrendDataPoint[]; insight: string }) {
  const maxVal = Math.max(5, ...data.map(d => d.muletillas_min));

  return (
    <Card className="p-5 bg-[#0F0F0F] border border-white/10">
      <h3 className="font-bold text-white mb-1">Muletillas por Minuto</h3>
      <p className="text-xs text-gray-500 mb-4">Menos muletillas = mensaje más limpio y creíble.</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="fecha" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <YAxis domain={[0, Math.ceil(maxVal)]} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
          <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}/min`, 'Muletillas']} />
          <Line
            type="monotone"
            dataKey="muletillas_min"
            stroke="#f97316"
            strokeWidth={3}
            dot={{ r: 5, fill: '#f97316', stroke: '#0F0F0F', strokeWidth: 2 }}
            activeDot={{ r: 7, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
      {insight && (
        <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-gray-400 leading-relaxed">
          <strong className="text-gray-300">Lectura:</strong> {insight}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// SESSION HISTORY TABLE
// ============================================================================

function scoreColor(val: number): string {
  if (val >= 70) return 'text-emerald-300/80';
  if (val >= 40) return 'text-gray-300';
  return 'text-red-400/50';
}

function SessionHistoryTable({ rows }: { rows: SessionHistoryRow[] }) {
  const cols = ['#', 'Fecha', 'Tipo', 'Global', 'Claridad', 'Estructura', 'Empatía', 'Objetivo', 'Mulet/min'];

  if (rows.length === 0) return null;

  return (
    <div>
      <SectionLabel text="Historial de Sesiones" />
      <Card className="bg-[#0F0F0F] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#141418]">
                {cols.map(col => (
                  <th key={col} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const isFirst = i === 0;
                return (
                  <tr
                    key={s.num}
                    className={`border-t border-white/5 transition-colors hover:bg-white/[0.03] ${isFirst ? 'bg-[#1bea9a]/5' : ''}`}
                  >
                    <td className={`px-3 py-2.5 text-gray-400 ${isFirst ? 'font-bold text-white' : ''}`}>{s.num}</td>
                    <td className={`px-3 py-2.5 text-gray-300 whitespace-nowrap ${isFirst ? 'font-bold text-white' : ''}`}>{s.fecha}</td>
                    <td className="px-3 py-2.5 text-gray-300 whitespace-nowrap">{s.tipo}</td>
                    <td className={`px-3 py-2.5 font-semibold ${scoreColor(s.global)}`}>{s.global}</td>
                    <td className={`px-3 py-2.5 ${scoreColor(s.claridad)}`}>{s.claridad}</td>
                    <td className={`px-3 py-2.5 ${scoreColor(s.estructura)}`}>{s.estructura}</td>
                    <td className={`px-3 py-2.5 ${scoreColor(s.empatia)}`}>{s.empatia}</td>
                    <td className={`px-3 py-2.5 ${scoreColor(s.objetivo)}`}>{s.objetivo}</td>
                    <td className={`px-3 py-2.5 text-gray-400 ${isFirst ? 'font-bold text-white' : ''}`}>{s.muletillas}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// ACTION PLAN
// ============================================================================

const GENERIC_TIPS = [
  {
    num: 1,
    title: 'Estructura tus mensajes',
    desc: 'Antes de hablar, define 3 puntos clave que quieres comunicar. Usa la estructura: contexto → mensaje principal → acción esperada.',
    meta: 'Impacto: Claridad y Estructura',
    accent: '#485df4',
  },
  {
    num: 2,
    title: 'Reduce muletillas con pausas',
    desc: 'Sustituye los "este", "o sea" y "bueno" por pausas breves de silencio. Graba 1 minuto de habla diario y cuenta tus muletillas para ganar conciencia.',
    meta: 'Impacto: Credibilidad y fluidez verbal',
    accent: '#f97316',
  },
  {
    num: 3,
    title: 'Convierte ideas en acciones concretas',
    desc: 'Cada vez que digas "hay que hacer X", reformula a "[Nombre] hace [X] para [fecha]". Esto mejora tu orientación a objetivo y tu liderazgo.',
    meta: 'Impacto: Objetivo y Persuasión',
    accent: '#ffd93d',
  },
  {
    num: 4,
    title: 'Practica la escucha activa',
    desc: 'Antes de responder, parafrasea lo que dijo la otra persona. Esto demuestra empatía, evita malentendidos y mejora la calidad de la conversación.',
    meta: 'Impacto: Empatía y Adaptación',
    accent: '#1bea9a',
  },
];

function ActionPlan() {
  return (
    <div>
      <SectionLabel text="Tips de Comunicación" />
      <div className="space-y-3">
        {GENERIC_TIPS.map((item) => (
          <Card
            key={item.num}
            className="p-5 bg-[#0F0F0F] border border-white/10 border-l-4 flex gap-4"
            style={{ borderLeftColor: `${item.accent}30` }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-extrabold flex-shrink-0"
              style={{ backgroundColor: `${item.accent}10`, color: `${item.accent}90` }}
            >
              {item.num}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white mb-1">{item.title}</h4>
              <p className="text-xs text-gray-400 leading-relaxed mb-2">{item.desc}</p>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">{item.meta}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// SECTION LABEL
// ============================================================================

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-white/10" />
      <span className="text-[10px] font-bold uppercase tracking-[3px] text-gray-500">{text}</span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyState() {
  return (
    <Card className="p-10 bg-[#0F0F0F] border border-white/10 text-center">
      <BarChart3 size={48} className="mx-auto mb-4 text-gray-600" />
      <h3 className="text-lg font-bold text-white mb-2">Aún no hay datos de progreso</h3>
      <p className="text-sm text-gray-500 max-w-md mx-auto">
        Cuando tengas conversaciones analizadas, aquí verás tus tendencias, radar de competencias y evolución de muletillas.
      </p>
    </Card>
  );
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

interface ProgressChartsSectionProps {
  conversations: OmiConversation[];
  formData?: FormResponse | null;
}

export function ProgressChartsSection({ conversations, formData }: ProgressChartsSectionProps) {
  const {
    trendData,
    dimensionSummary,
    radarData,
    fillerWordsInsight,
    radarInsight,
    sessionHistory,
    hasData,
  } = useProgressChartsData(conversations);

  // Build auto-assessment values from formData (same mapping as web)
  const autoValues = useMemo(() => {
    if (!formData) return {} as Record<string, number>;
    const qVal = (q?: string) => q ? parseInt(q) * 20 : 0;
    return {
      'Claridad':    Math.round((qVal(formData.q5) + qVal(formData.q6)) / 2),
      'Estructura':  Math.round((qVal(formData.q11) + qVal(formData.q12)) / 2),
      'Empatía':     Math.round((qVal(formData.q15) + qVal(formData.q16)) / 2),
      'Adaptación':  Math.round((qVal(formData.q7) + qVal(formData.q8)) / 2),
      'Vocabulario': Math.round((qVal(formData.q9) + qVal(formData.q10)) / 2),
      'Objetivo':    Math.round((qVal(formData.q13) + qVal(formData.q14)) / 2),
    } as Record<string, number>;
  }, [formData]);

  // Merge auto-assessment into radarData
  const mergedRadarData = useMemo(() => {
    if (!radarData.length) return radarData;
    return radarData.map(point => ({
      ...point,
      auto: autoValues[point.dim] ?? 0,
    }));
  }, [radarData, autoValues]);

  if (!hasData) {
    return (
      <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center gap-4 py-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
          <span className="text-xs font-bold uppercase tracking-[4px] text-pink-500/60">Análisis de Progreso</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Divider */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
        <span className="text-xs font-bold uppercase tracking-[4px] text-pink-500/60">Análisis de Progreso</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
      </div>

      {/* 1. Dimension Trends (full width) */}
      <DimensionTrendChart data={trendData} summary={dimensionSummary} />

      {/* 2. Radar + Filler Words side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RadarComparisonChart data={mergedRadarData} insight={radarInsight} />
        <FillerWordsTrendChart data={trendData} insight={fillerWordsInsight} />
      </div>

      {/* 3. Session History Table */}
      <SessionHistoryTable rows={sessionHistory} />

      {/* 4. Action Plan */}
      <ActionPlan />
    </div>
  );
}
