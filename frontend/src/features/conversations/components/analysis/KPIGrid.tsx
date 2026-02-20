import { CommunicationFeedback } from '../../services/conversations.service';

interface KPICardProps {
  emoji: string;
  value: number | string;
  label: string;
  color: string;
}

function KPICard({ emoji, value, label, color }: KPICardProps) {
  return (
    <div
      className="rounded-lg bg-card border border-border p-3"
      style={{ borderTopWidth: '3px', borderTopColor: color }}
    >
      <div className="text-lg mb-1">{emoji}</div>
      <div className="text-3xl font-extrabold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

interface KPIGridProps {
  feedback: CommunicationFeedback;
}

export function KPIGrid({ feedback }: KPIGridProps) {
  const r = feedback.radiografia;
  const p = feedback.preguntas;
  const t = feedback.temas;

  const kpis: KPICardProps[] = [
    {
      emoji: '\u{1F5E3}\u{FE0F}',
      value: r?.muletillas_total ?? 0,
      label: 'Muletillas',
      color: '#f97316',
    },
    {
      emoji: '\u{2696}\u{FE0F}',
      value: r?.ratio_habla !== undefined ? `${Math.round(r.ratio_habla * 100)}%` : '--',
      label: 'Ratio habla',
      color: '#3b82f6',
    },
    {
      emoji: '\u{2753}',
      value: p?.total_usuario ?? 0,
      label: 'Preguntas hechas',
      color: '#8b5cf6',
    },
    {
      emoji: '\u{1F4DD}',
      value: r?.palabras_usuario ?? 0,
      label: 'Palabras usuario',
      color: '#22c55e',
    },
    {
      emoji: '\u{1F4AC}',
      value: r?.palabras_otros ?? 0,
      label: 'Palabras otros',
      color: '#06b6d4',
    },
    {
      emoji: '\u{1F4CB}',
      value: t?.temas_tratados?.length ?? 0,
      label: 'Temas tratados',
      color: '#ec4899',
    },
    {
      emoji: '\u{2705}',
      value: t?.acciones_usuario?.length ?? 0,
      label: 'Compromisos',
      color: '#14b8a6',
    },
    {
      emoji: '\u{1F6AA}',
      value: t?.temas_sin_cerrar?.length ?? 0,
      label: 'Temas pendientes',
      color: '#f59e0b',
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
