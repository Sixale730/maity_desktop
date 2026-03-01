'use client';

import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface KPICardProps {
  emoji: string;
  value: number | string;
  label: string;
  detail?: string;
  color: string;
}

function KPICard({ emoji, value, label, detail, color }: KPICardProps) {
  return (
    <div
      className="rounded-lg bg-card border border-border p-3"
      style={{ borderTopWidth: '3px', borderTopColor: color }}
    >
      <div className="text-lg mb-1">{emoji}</div>
      <div className="text-2xl font-extrabold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {detail && <div className="text-xs text-muted-foreground/70 mt-0.5">{detail}</div>}
    </div>
  );
}

interface KPIGridProps {
  feedback: CommunicationFeedbackV4;
}

export function KPIGrid({ feedback }: KPIGridProps) {
  const r = feedback.radiografia;
  const mejor = r?.mejor_dimension;
  const peor = r?.peor_dimension;
  const participacion = r?.participacion_pct;
  const puertas = r?.puertas_emocionales;

  // Calculate user participation %
  let participacionStr = '--';
  if (participacion) {
    const values = Object.values(participacion);
    if (values.length > 0) {
      const maxPct = Math.max(...values);
      const maxName = Object.entries(participacion).find(([, v]) => v === maxPct)?.[0];
      participacionStr = `${Math.round(maxPct)}%`;
      if (maxName) participacionStr += ` ${maxName}`;
    }
  }

  const kpis: KPICardProps[] = [
    {
      emoji: '🏆',
      value: mejor?.puntaje ?? '--',
      label: 'Mejor dimensión',
      detail: mejor?.nombre,
      color: '#22c55e',
    },
    {
      emoji: '📉',
      value: peor?.puntaje ?? '--',
      label: 'Dimensión a mejorar',
      detail: peor?.nombre,
      color: '#ef4444',
    },
    {
      emoji: '⚖️',
      value: participacionStr,
      label: 'Participación',
      color: '#3b82f6',
    },
    {
      emoji: '🗣️',
      value: r?.muletillas_total ?? 0,
      label: 'Muletillas',
      detail: r?.muletillas_frecuencia,
      color: '#f97316',
    },
    {
      emoji: '🚪',
      value: puertas?.momentos_vulnerabilidad ?? 0,
      label: 'Puertas emocionales',
      detail: puertas ? `${puertas.exploradas} exploradas` : undefined,
      color: '#8b5cf6',
    },
    {
      emoji: '💡',
      value: feedback.recomendaciones?.length ?? 0,
      label: 'Recomendaciones',
      color: '#06b6d4',
    },
    {
      emoji: '🔍',
      value: Object.values(feedback.dimensiones ?? {}).reduce<number>(
        (sum, d) => sum + ((d as { hallazgos?: unknown[] })?.hallazgos?.length ?? 0), 0
      ),
      label: 'Hallazgos',
      color: '#ec4899',
    },
    {
      emoji: '📊',
      value: r?.calidad_global ?? '--',
      label: 'Calidad global',
      color: '#14b8a6',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}
