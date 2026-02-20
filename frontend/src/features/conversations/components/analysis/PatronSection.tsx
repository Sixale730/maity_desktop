import { CommunicationFeedback } from '../../services/conversations.service';

interface PatronSectionProps {
  feedback: CommunicationFeedback;
}

export function PatronSection({ feedback }: PatronSectionProps) {
  const patron = feedback.patron;
  if (!patron) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Patron de Comunicacion</h3>
      <div
        className="rounded-lg border border-border bg-card p-4"
        style={{ borderLeftWidth: '4px', borderLeftColor: '#9b4dca' }}
      >
        <div className="text-sm font-semibold text-foreground mb-2">
          {patron.actual} → {patron.evolucion}
        </div>

        {patron.senales && patron.senales.length > 0 && (
          <ul className="space-y-1 mb-3">
            {patron.senales.map((senal, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">•</span>
                <span>{senal}</span>
              </li>
            ))}
          </ul>
        )}

        {patron.que_cambiaria && (
          <p className="text-sm text-muted-foreground italic border-t border-border pt-2 mt-2">
            {patron.que_cambiaria}
          </p>
        )}
      </div>
    </div>
  );
}
