import { CommunicationFeedback } from '../../services/conversations.service';

interface MuletillasSectionProps {
  feedback: CommunicationFeedback;
}

export function MuletillasSection({ feedback }: MuletillasSectionProps) {
  const muletillas = feedback.radiografia?.muletillas_detectadas;
  if (!muletillas || Object.keys(muletillas).length === 0) return null;

  const entries = Object.entries(muletillas)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxCount = Math.max(...entries.map(([, c]) => c), 1);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Muletillas Detectadas</h3>
      <div className="space-y-2">
        {entries.map(([word, count]) => (
          <div key={word} className="flex items-center gap-3">
            <span className="text-sm text-foreground w-24 truncate font-medium">{word}</span>
            <div className="flex-1 h-5 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-sm font-bold text-foreground w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
      {feedback.radiografia?.muletillas_frecuencia && (
        <p className="text-xs text-muted-foreground mt-2">
          {feedback.radiografia.muletillas_frecuencia}
        </p>
      )}
    </div>
  );
}
