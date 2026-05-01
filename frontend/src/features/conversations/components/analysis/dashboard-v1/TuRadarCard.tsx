'use client';
import { RadarCalidad } from './RadarCalidad';
import type { CommunicationFeedbackV4 } from './types';
import { scrollToSection } from './utils';

function dimAnchor(key: string): string {
  return `dv1-hallazgo-${key.trim().toLowerCase()}`;
}

export function TuRadarCard({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const { calidad_global, resumen } = feedback;
  if (!calidad_global) return null;

  const fortaleza = resumen?.fortaleza;
  const fortalezaHint = resumen?.fortaleza_hint;
  const mejorar = resumen?.mejorar;
  const mejorarHint = resumen?.mejorar_hint;
  const showBadges = !!(fortaleza || mejorar);

  return (
    <div className="tu-radar-card">
      <div className="tu-radar-body">
        <div className="tu-radar-chart-wrap">
          <RadarCalidad calidad={calidad_global} />
        </div>
      </div>
      {showBadges && (
        <div className="tu-radar-badges">
          {fortaleza && (
            <div
              className="tu-radar-badge badge-str clickable"
              role="button"
              tabIndex={0}
              onClick={() => scrollToSection(dimAnchor(fortaleza))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  scrollToSection(dimAnchor(fortaleza));
                }
              }}
            >
              <span className="badge-icon">💪</span>
              <span className="badge-value">{fortaleza}</span>
              {fortalezaHint && <span className="badge-hint">{fortalezaHint}</span>}
            </div>
          )}
          {mejorar && (
            <div
              className="tu-radar-badge badge-imp clickable"
              role="button"
              tabIndex={0}
              onClick={() => scrollToSection(dimAnchor(mejorar))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  scrollToSection(dimAnchor(mejorar));
                }
              }}
            >
              <span className="badge-icon">🎯</span>
              <span className="badge-value">{mejorar}</span>
              {mejorarHint && <span className="badge-hint">{mejorarHint}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
