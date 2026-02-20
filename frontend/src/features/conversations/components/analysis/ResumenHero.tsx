import { CommunicationFeedback } from '../../services/conversations.service';

function getScoreColor(score: number): string {
  if (score < 4) return '#ef4444';
  if (score < 6) return '#f97316';
  if (score < 8) return '#eab308';
  return '#22c55e';
}

function getScoreLabel(score: number): string {
  if (score < 4) return 'Necesita trabajo';
  if (score < 6) return 'En desarrollo';
  if (score < 8) return 'Buen nivel';
  return 'Excelente';
}

interface ResumenHeroProps {
  feedback: CommunicationFeedback;
}

export function ResumenHero({ feedback }: ResumenHeroProps) {
  const score = feedback.overall_score;
  if (score === undefined) return null;

  const color = getScoreColor(score);
  const label = getScoreLabel(score);
  const percentage = (score / 10) * 100;

  // SVG semicircle gauge
  const radius = 80;
  const strokeWidth = 12;
  const circumference = Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center py-6">
      <svg width="200" height="120" viewBox="0 0 200 120">
        {/* Background arc */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/20"
          strokeLinecap="round"
        />
        {/* Score arc */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
        {/* Score number */}
        <text
          x="100"
          y="85"
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: '36px', fontWeight: 800 }}
        >
          {score.toFixed(1)}
        </text>
        <text
          x="100"
          y="105"
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: '12px' }}
        >
          {label}
        </text>
      </svg>

      {(feedback.feedback || feedback.summary) && (
        <p className="text-sm text-muted-foreground text-center mt-3 max-w-lg">
          {feedback.feedback || feedback.summary}
        </p>
      )}
    </div>
  );
}
