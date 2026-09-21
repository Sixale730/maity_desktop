'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ProgressChartsSection.tsx
// Adaptaciones desktop: 'use client'; @/ui/components/ui/* resuelve a @/components/ui/* por alias (tsconfig/vitest); @/features/omi/* resuelve a los adapters del desktop por alias (features/dashboard/adapters, dashboard-v1/adapter); formatter del Tooltip sin anotar `v: number` (el recharts del desktop tipa el valor como ValueType, igual que CommunicationTrendChart).
import { Card } from '@/ui/components/ui/card';
import { Spinner } from '@/ui/components/ui/spinner';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { OmiConversationListItem } from '@/features/omi/services/omi.service';
import {
  useProgressChartsData,
  type TrendDataPoint,
} from '../../hooks/useProgressChartsData';

// ============================================================================
// SHARED CHART CONFIG
// ============================================================================

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

const AXIS_STYLE = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };
const GRID_STYLE = { stroke: 'hsl(var(--border))', strokeDasharray: '3 3' };

// ============================================================================
// FILLER WORDS TREND
// ============================================================================

function FillerWordsTrendChart({ data, insight }: { data: TrendDataPoint[]; insight: string }) {
  const maxVal = Math.max(5, ...data.map(d => d.muletillas_min));

  return (
    <Card className="p-5 bg-card border border-border">
      <h3 className="font-bold text-foreground mb-1">Muletillas por Minuto</h3>
      <p className="text-xs text-muted-foreground mb-4">Menos muletillas = mensaje más limpio y creíble.</p>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="fecha" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <YAxis domain={[0, Math.ceil(maxVal)]} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${typeof v === 'number' ? v : 0}/min`, 'Muletillas']} />
            <Line
              type="monotone"
              dataKey="muletillas_min"
              stroke="#f97316"
              strokeWidth={3}
              dot={{ r: 5, fill: '#f97316', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
              activeDot={{ r: 7, fill: '#f97316', stroke: 'hsl(var(--foreground))', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {insight && (
        <div className="mt-3 p-3 rounded-lg bg-muted border border-border text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Lectura:</strong> {insight}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// SESSION HISTORY TABLE
// ============================================================================

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyState() {
  return (
    <Card className="p-10 bg-card border border-border text-center">
      <BarChart3 size={48} className="mx-auto mb-4 text-muted-foreground" />
      <h3 className="text-lg font-bold text-foreground mb-2">Aún no hay datos de progreso</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Cuando tengas conversaciones analizadas, aquí verás la evolución de muletillas, tu historial de sesiones y tips para mejorar.
      </p>
    </Card>
  );
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

interface ProgressChartsSectionProps {
  conversations: OmiConversationListItem[];
}

export function ProgressChartsSection({ conversations }: ProgressChartsSectionProps) {
  const {
    trendData,
    fillerWordsInsight,
    loading,
    hasData,
  } = useProgressChartsData(conversations);

  if (loading) {
    return (
      <div className="mt-8 flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center gap-4 py-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
          <span className="text-xs font-bold uppercase tracking-[4px] text-pink-700/70 dark:text-pink-500/60">Análisis de Progreso</span>
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
        <span className="text-xs font-bold uppercase tracking-[4px] text-pink-700/70 dark:text-pink-500/60">Análisis de Progreso</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-pink-500/30 to-transparent" />
      </div>

      {/* Filler Words */}
      <FillerWordsTrendChart data={trendData} insight={fillerWordsInsight} />
    </div>
  );
}
