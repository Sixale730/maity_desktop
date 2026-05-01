'use client';
import type { ReactNode } from 'react';
import type { CommunicationFeedbackV4 } from './types';
import { scrollToSection } from './utils';

type Accent = 'red' | 'blue' | 'purple' | 'orange';

interface KPICardProps {
  icon: string;
  number: string | number;
  label: string;
  detail: string;
  extra?: ReactNode;
  accent: Accent;
  onClick?: () => void;
}

function KPICard({ icon, number, label, detail, extra, accent, onClick }: KPICardProps) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`kpi-card accent-${accent}${clickable ? ' clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-number">{number}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-detail">{detail}</div>
      {extra && <div className="kpi-extra">{extra}</div>}
    </div>
  );
}

export function KPIGrid({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const r = feedback.radiografia;
  const recos = feedback.recomendaciones;
  const recoCount = recos?.length;
  if (!r && recoCount == null) return null;

  const muletillasList =
    r?.muletillas_detalle && Object.keys(r.muletillas_detalle).length > 0
      ? Object.entries(r.muletillas_detalle)
          .slice(0, 3)
          .map(([w, n]) => `${w} (${n})`)
          .join(', ')
      : null;

  return (
    <div className="kpi-grid">
      {r?.muletillas_total != null && (
        <KPICard
          icon="🗣"
          number={r.muletillas_total}
          label="Muletillas"
          detail={muletillasList ?? r.muletillas_frecuencia ?? ''}
          extra={
            muletillasList && r.muletillas_frecuencia ? (
              <span>{r.muletillas_frecuencia}</span>
            ) : null
          }
          accent="red"
          onClick={() => scrollToSection('dv1-insights')}
        />
      )}
      {r?.preguntas_total != null && (
        <KPICard
          icon="❓"
          number={r.preguntas_total}
          label="Preguntas"
          detail="Hechas por ti"
          accent="blue"
          onClick={() => scrollToSection('dv1-insights')}
        />
      )}
      {r?.ratio_habla != null && (
        <KPICard
          icon="⏱"
          number={`${r.ratio_habla}/${100 - r.ratio_habla}`}
          label="% que hablaste"
          detail="vs. la otra persona"
          accent="purple"
          onClick={() => scrollToSection('dv1-insights')}
        />
      )}
      {recoCount != null && recoCount > 0 && (
        <KPICard
          icon="📌"
          number={recoCount}
          label="Recomendaciones"
          detail="Para tu próxima vez"
          extra={
            recos?.[0]?.titulo ? (
              <span className="kpi-preview-reco">{recos[0].titulo}</span>
            ) : null
          }
          accent="orange"
          onClick={() => scrollToSection('dv1-recomendaciones')}
        />
      )}
    </div>
  );
}
