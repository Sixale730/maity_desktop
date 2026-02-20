import { CommunicationFeedback } from '../../services/conversations.service';

interface PreguntasSectionProps {
  feedback: CommunicationFeedback;
}

export function PreguntasSection({ feedback }: PreguntasSectionProps) {
  const preguntas = feedback.preguntas;
  if (!preguntas) return null;

  const hasLists = (preguntas.preguntas_usuario && preguntas.preguntas_usuario.length > 0) ||
    (preguntas.preguntas_otros && preguntas.preguntas_otros.length > 0);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Preguntas</h3>
      {hasLists ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* User questions */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl font-bold text-foreground">{preguntas.total_usuario ?? 0}</span>
              <span className="text-sm text-muted-foreground">Tus preguntas</span>
            </div>
            {preguntas.preguntas_usuario && preguntas.preguntas_usuario.length > 0 && (
              <ul className="space-y-1.5">
                {preguntas.preguntas_usuario.map((q, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">?</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Others' questions */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl font-bold text-foreground">{preguntas.total_otros ?? 0}</span>
              <span className="text-sm text-muted-foreground">Preguntas recibidas</span>
            </div>
            {preguntas.preguntas_otros && preguntas.preguntas_otros.length > 0 && (
              <ul className="space-y-1.5">
                {preguntas.preguntas_otros.map((q, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-muted-foreground/60 mt-0.5">?</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        /* Fallback: just totals */
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-secondary rounded-lg text-center">
            <div className="text-xs text-muted-foreground mb-1">Usuario</div>
            <div className="text-2xl font-bold text-foreground">{preguntas.total_usuario ?? 0}</div>
          </div>
          <div className="p-3 bg-secondary rounded-lg text-center">
            <div className="text-xs text-muted-foreground mb-1">Otros</div>
            <div className="text-2xl font-bold text-foreground">{preguntas.total_otros ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}
