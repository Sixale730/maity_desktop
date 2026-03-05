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
      className="rounded-lg bg-card border border-border p-3 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTopWidth: '3px', borderTopColor: color }}
    >
      <div className="text-xl mb-1">{emoji}</div>
      <div className="text-3xl font-extrabold" style={{ color }}>{value}</div>
      <div className="text-sm font-semibold text-foreground mt-0.5">{label}</div>
      {detail && <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{detail}</div>}
    </div>
  );
}

interface KPIGridProps {
  feedback: CommunicationFeedbackV4;
  speakerNameMap?: Record<string, string>;
}

export function KPIGrid({ feedback, speakerNameMap = {} }: KPIGridProps) {
  const r = feedback.radiografia;
  const mejor = r?.mejor_dimension;
  const peor = r?.peor_dimension;
  const participacion = r?.participacion_pct;
  const puertas = r?.puertas_emocionales;

  // KPI 1 — Muletillas
  const muletillasTotal = r?.muletillas_total ?? 0;
  const muletillasColor = muletillasTotal > 10 ? '#ef4444' : '#22c55e';
  let muletillasDetail = r?.muletillas_frecuencia ?? '';
  if (r?.muletillas_detalle) {
    const top3 = Object.entries(r.muletillas_detalle)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ×${v}`)
      .join(', ');
    if (top3) {
      muletillasDetail = muletillasDetail ? `${top3} · ${muletillasDetail}` : top3;
    }
  }

  // KPI 2 — Ratio de habla
  const ratio = r?.ratio_habla;
  let ratioValue: string = '--';
  let ratioDetail = '';
  let ratioColor = '#14b8a6';
  if (ratio != null) {
    ratioValue = `${ratio.toFixed(1)}x`;
    if (ratio >= 0.8 && ratio <= 1.2) {
      ratioDetail = 'Equilibrado';
      ratioColor = '#22c55e';
    } else if (ratio > 1.2) {
      ratioDetail = 'Hablas más';
      ratioColor = ratio > 2 ? '#3b82f6' : '#eab308';
    } else {
      ratioDetail = 'Otros hablan más';
      ratioColor = '#3b82f6';
    }
  }

  // KPI 3 — Preguntas hechas
  const preguntas = r?.preguntas;
  let preguntasTotal = 0;
  let preguntasDetail = '';
  if (preguntas) {
    preguntasTotal = Object.values(preguntas).reduce((sum, v) => sum + v, 0);
    preguntasDetail = Object.entries(preguntas).map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  // KPI 4 — Participación
  let participacionValue = '--';
  let participacionDetail = '';
  if (participacion) {
    const entries = Object.entries(participacion);
    participacionValue = entries.map(([, v]) => `${Math.round(v)}%`).join(' / ');
    participacionDetail = entries.map(([k, v]) => `${speakerNameMap[k] || k}: ${Math.round(v)}%`).join(', ');
  }

  // KPI 5 — Mejor dimensión
  const mejorLabel = mejor ? `Mejor: ${mejor.nombre}` : 'Mejor dimensión';
  const mejorDetail = feedback.calidad_global?.fortaleza_hint
    ?? (mejor ? `${mejor.nombre} es tu fortaleza` : undefined);

  // KPI 6 — Dimensión a mejorar
  const peorLabel = peor ? `Mejorar: ${peor.nombre}` : 'Dimensión a mejorar';
  const peorDetail = feedback.calidad_global?.mejorar_hint
    ?? (peor ? `${peor.nombre} necesita atención` : undefined);

  // KPI 7 — Puertas emocionales
  let puertasValue: string = '--';
  let puertasDetail: string | undefined;
  if (puertas) {
    puertasValue = `${puertas.exploradas}/${puertas.abiertas}`;
    const noExploradas = puertas.no_exploradas ?? (puertas.abiertas - puertas.exploradas);
    puertasDetail = noExploradas > 0 ? `${noExploradas} no exploradas` : 'Todas exploradas ✓';
  }

  // KPI 8 — Recomendaciones
  const recomendaciones = feedback.recomendaciones ?? [];
  const recsCount = recomendaciones.length;
  let recsDetail = 'Sin recomendaciones';
  if (recsCount > 0) {
    recsDetail = recomendaciones.slice(0, 2).map((r) => r.titulo).join(' · ');
  }

  const kpis: KPICardProps[] = [
    {
      emoji: '🗣️',
      value: muletillasTotal,
      label: 'Muletillas detectadas',
      detail: muletillasDetail || undefined,
      color: muletillasColor,
    },
    {
      emoji: '⚖️',
      value: ratioValue,
      label: 'Ratio de habla',
      detail: ratioDetail || undefined,
      color: ratioColor,
    },
    {
      emoji: '❓',
      value: preguntasTotal,
      label: 'Preguntas hechas',
      detail: preguntasDetail || undefined,
      color: '#3b82f6',
    },
    {
      emoji: '📊',
      value: participacionValue,
      label: 'Participación',
      detail: participacionDetail || undefined,
      color: '#06b6d4',
    },
    {
      emoji: '🏆',
      value: mejor?.puntaje ?? '--',
      label: mejorLabel,
      detail: mejorDetail,
      color: '#22c55e',
    },
    {
      emoji: '🎯',
      value: peor?.puntaje ?? '--',
      label: peorLabel,
      detail: peorDetail,
      color: '#f97316',
    },
    {
      emoji: '🔑',
      value: puertasValue,
      label: 'Puertas emocionales',
      detail: puertasDetail,
      color: '#8b5cf6',
    },
    {
      emoji: '💡',
      value: `${recsCount} clave`,
      label: 'Recomendaciones',
      detail: recsDetail,
      color: '#3b82f6',
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
