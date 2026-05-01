'use client';
import { GaugeChart } from './GaugeChart';
import type { CommunicationFeedbackV4 } from './types';

function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

export function ResumenHero({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const { resumen, calidad_global, patron } = feedback;
  if (!resumen) return null;
  const score = resumen.puntuacion_global ?? calidad_global?.puntaje ?? 0;
  const scoreColor = getScoreColor(score);
  const bullets =
    resumen.bullets && resumen.bullets.length > 0
      ? resumen.bullets
      : resumen.descripcion
        ? [resumen.descripcion]
        : [];

  return (
    <div className="resumen-hero">
      <div className="gauge-container">
        <GaugeChart score={score} maxScore={100} size={200} />
        <div className="gauge-score" style={{ color: scoreColor }}>
          {score}
        </div>
        {resumen.nivel && <div className="gauge-label">{resumen.nivel}</div>}
      </div>
      <div className="resumen-text">
        {bullets.length > 0 && (
          <ul>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {patron && (patron.actual || patron.evolucion || patron.que_cambiaria) && (
          <div className="patron-cambio">
            {(patron.actual || patron.evolucion) && (
              <div>
                {patron.actual && <strong>{patron.actual}</strong>}
                {patron.actual && patron.evolucion && <span> → </span>}
                {patron.evolucion && <strong>{patron.evolucion}</strong>}
              </div>
            )}
            {patron.que_cambiaria && <div>💡 {patron.que_cambiaria}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
