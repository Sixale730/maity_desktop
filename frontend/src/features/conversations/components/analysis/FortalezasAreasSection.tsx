import { CheckCircle2 } from 'lucide-react';
import { CommunicationFeedback } from '../../services/conversations.service';

const areaColors = ['#ef4444', '#f97316', '#eab308', '#8b5cf6'];

interface FortalezasAreasSectionProps {
  feedback: CommunicationFeedback;
}

export function FortalezasAreasSection({ feedback }: FortalezasAreasSectionProps) {
  const hasStrengths = feedback.strengths && feedback.strengths.length > 0;
  const hasAreas = feedback.areas_to_improve && feedback.areas_to_improve.length > 0;

  if (!hasStrengths && !hasAreas) return null;

  return (
    <div className="space-y-6">
      {/* Fortalezas */}
      {hasStrengths && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Fortalezas</h3>
          <ul className="space-y-2">
            {feedback.strengths!.map((s, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Areas de mejora */}
      {hasAreas && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Areas de Mejora</h3>
          <div className="space-y-2">
            {feedback.areas_to_improve!.map((a, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-3"
                style={{ borderLeftWidth: '3px', borderLeftColor: areaColors[i % areaColors.length] }}
              >
                <p className="text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
