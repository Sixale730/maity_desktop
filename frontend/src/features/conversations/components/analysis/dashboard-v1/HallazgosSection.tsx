'use client';
import { useState } from 'react';
import type { CommunicationFeedbackV4, DimensionItem } from './types';

const DIMENSION_LABELS: Record<string, string> = {
  claridad: 'Claridad',
  estructura: 'Estructura',
  persuasion: 'Persuasión',
  proposito: 'Propósito',
  empatia: 'Empatía',
  adaptacion: 'Adaptación',
};

function getColorClass(score: number): {
  border: 'border-green' | 'border-yellow' | 'border-red';
  badge: 'badge-green' | 'badge-yellow' | 'badge-red';
  fill: 'fill-green' | 'fill-yellow' | 'fill-red';
  text: 'text-green' | 'text-yellow' | 'text-red';
} {
  if (score >= 70)
    return { border: 'border-green', badge: 'badge-green', fill: 'fill-green', text: 'text-green' };
  if (score >= 40)
    return {
      border: 'border-yellow',
      badge: 'badge-yellow',
      fill: 'fill-yellow',
      text: 'text-yellow',
    };
  return { border: 'border-red', badge: 'badge-red', fill: 'fill-red', text: 'text-red' };
}

function HallazgoCard({
  name,
  dim,
  anchorId,
}: {
  name: string;
  dim: DimensionItem;
  anchorId: string;
}) {
  const [open, setOpen] = useState(false);
  const c = getColorClass(dim.puntaje);

  return (
    <div id={anchorId} className={`hallazgo-card ${c.border}${open ? ' open' : ''}`}>
      <h3>
        {name}
        <span className={`score-badge ${c.badge}`}>{dim.puntaje}/100</span>
      </h3>
      {dim.que_significa && <p className="que-significa">{dim.que_significa}</p>}
      <div
        className="hallazgo-toggle"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
      >
        Ver detalles
      </div>
      <div className="hallazgo-details">
        {(dim.cita || dim.prueba_esto) && (
          <p style={{ fontSize: '.9rem', lineHeight: 1.6, marginTop: 8 }}>
            {dim.cita && (
              <>
                <strong>Dijiste:</strong> «{dim.cita}»
              </>
            )}
            {dim.cita && dim.prueba_esto && <span> — </span>}
            {dim.prueba_esto && (
              <>
                <strong>Prueba esto:</strong> {dim.prueba_esto}
              </>
            )}
          </p>
        )}
        {dim.sub_scores && dim.sub_scores.length > 0 && (
          <div className="sub-scores">
            {dim.sub_scores.map((sub, i) => {
              const sc = getColorClass(sub.valor);
              return (
                <div key={i} className="sub-score-row">
                  <span className="sub-score-label">{sub.label}</span>
                  <div className="sub-score-track">
                    <div
                      className={`sub-score-fill ${sc.fill}`}
                      style={{ width: `${sub.valor}%` }}
                    />
                  </div>
                  <span className={`sub-score-val ${sc.text}`}>{sub.valor}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function HallazgosSection({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const dims = feedback.dimensiones;
  if (!dims) return null;
  const entries = Object.entries(dims).filter(
    ([, v]) => v != null,
  ) as Array<[string, DimensionItem]>;
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([key, dim]) => (
        <HallazgoCard
          key={key}
          name={DIMENSION_LABELS[key] ?? key}
          dim={dim}
          anchorId={`dv1-hallazgo-${key}`}
        />
      ))}
    </>
  );
}
