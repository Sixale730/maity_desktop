'use client';
import { useState, useEffect } from 'react';
import type { CommunicationFeedbackV4, Recomendacion } from './types';

function RecomendacionCard({
  rec,
  index,
  defaultOpen,
}: {
  rec: Recomendacion;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  const priority = rec.prioridad ?? index + 1;
  return (
    <div className={`reco-card${open ? ' open' : ''}`}>
      <span className="reco-num">{priority}</span>
      <h4 onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        {rec.titulo}
        <span className="reco-toggle-hint">{open ? 'Ocultar' : 'Ver más'}</span>
      </h4>
      <div className="reco-details">
        {rec.descripcion && <p className="descripcion">{rec.descripcion}</p>}
        {rec.texto_original && (
          <div className="original">
            <strong>Texto original:</strong> {rec.texto_original}
          </div>
        )}
        {rec.texto_mejorado && (
          <div className="mejorado">
            <strong>Texto mejorado:</strong> {rec.texto_mejorado}
          </div>
        )}
        {rec.impacto && (
          <p className="impacto">
            <strong>Impacto:</strong> {rec.impacto}
          </p>
        )}
        {rec.por_que && (
          <p className="por-que">
            <strong>Por qué:</strong> {rec.por_que}
          </p>
        )}
      </div>
    </div>
  );
}

export function RecomendacionesSection({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const recs = feedback.recomendaciones;
  if (!recs || recs.length === 0) return null;
  const top3 = recs.slice(0, 3);
  return (
    <div id="dv1-recomendaciones">
      {top3.map((rec, i) => (
        <RecomendacionCard key={i} rec={rec} index={i} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
