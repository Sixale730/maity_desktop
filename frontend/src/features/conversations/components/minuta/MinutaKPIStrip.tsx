'use client';

import type { MeetingMinutesData } from '../../services/conversations.service';

interface MinutaKPIStripProps {
  data: MeetingMinutesData;
}

export function MinutaKPIStrip({ data }: MinutaKPIStripProps) {
  const kpis = [
    { emoji: '📋', value: data.temas?.length ?? 0, label: 'Temas' },
    { emoji: '✅', value: data.decisiones?.length ?? 0, label: 'Decisiones' },
    { emoji: '📌', value: data.acciones?.lista?.length ?? 0, label: 'Acciones' },
    { emoji: '⚠️', value: data.acciones_incompletas?.length ?? 0, label: 'Pendientes' },
    { emoji: '⏱️', value: data.meta?.duracion_minutos ? `${data.meta.duracion_minutos}m` : '--', label: 'Duración' },
    { emoji: '📊', value: data.efectividad?.score_global ?? '--', label: 'Efectividad' },
  ];

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="rounded-lg bg-muted/50 border border-border p-3 text-center">
          <div className="text-lg">{kpi.emoji}</div>
          <div className="text-xl font-bold text-foreground">{kpi.value}</div>
          <div className="text-xs text-muted-foreground">{kpi.label}</div>
        </div>
      ))}
    </div>
  );
}
