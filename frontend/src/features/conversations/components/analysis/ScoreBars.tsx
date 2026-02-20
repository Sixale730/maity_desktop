import { CommunicationFeedback } from '../../services/conversations.service';

interface ScoreBarProps {
  label: string;
  score: number;
  color: string;
  emoji: string;
}

function getEmoji(score: number): string {
  if (score < 4) return '\u{1F534}';
  if (score < 6) return '\u{1F7E0}';
  if (score < 8) return '\u{1F7E1}';
  return '\u{1F7E2}';
}

function ScoreBar({ label, score, color, emoji }: ScoreBarProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-base">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-foreground font-medium">{label}</span>
          <span className="text-sm font-bold text-foreground">{score.toFixed(1)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${(score / 10) * 100}%`, backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}

interface ScoreBarsProps {
  feedback: CommunicationFeedback;
}

export function ScoreBars({ feedback }: ScoreBarsProps) {
  const metrics: { key: string; label: string; color: string; value?: number }[] = [
    { key: 'clarity', label: 'Claridad', color: '#485df4', value: feedback.clarity },
    { key: 'structure', label: 'Estructura', color: '#ff8c42', value: feedback.structure },
    { key: 'vocabulario', label: 'Vocabulario', color: '#1bea9a', value: feedback.vocabulario },
    { key: 'empatia', label: 'Empatia', color: '#ef4444', value: feedback.empatia },
    { key: 'objetivo', label: 'Objetivo', color: '#ffd93d', value: feedback.objetivo },
    { key: 'adaptacion', label: 'Adaptacion', color: '#9b4dca', value: feedback.adaptacion ?? feedback.engagement },
  ];

  const validMetrics = metrics.filter((m) => m.value !== undefined);
  if (validMetrics.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-foreground">Competencias de Comunicacion</h3>
      <div className="space-y-3">
        {validMetrics.map((m) => (
          <ScoreBar
            key={m.key}
            label={m.label}
            score={m.value!}
            color={m.color}
            emoji={getEmoji(m.value!)}
          />
        ))}
      </div>
    </div>
  );
}
