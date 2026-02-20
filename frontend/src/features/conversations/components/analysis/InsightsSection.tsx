import { CommunicationFeedback } from '../../services/conversations.service';

const borderColors = ['#485df4', '#1bea9a', '#ff8c42'];

interface InsightsSectionProps {
  feedback: CommunicationFeedback;
}

export function InsightsSection({ feedback }: InsightsSectionProps) {
  const insights = feedback.insights;
  if (!insights || insights.length === 0) return null;

  const displayed = insights.slice(0, 3);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Lo que quizas no notaste</h3>
      <div className="space-y-3">
        {displayed.map((insight, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-4"
            style={{ borderLeftWidth: '4px', borderLeftColor: borderColors[i % borderColors.length] }}
          >
            <div className="text-sm font-semibold text-foreground mb-1">{insight.dato}</div>
            <p className="text-sm text-muted-foreground mb-2">{insight.por_que}</p>
            <p className="text-sm text-primary/80 italic">{insight.sugerencia}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
