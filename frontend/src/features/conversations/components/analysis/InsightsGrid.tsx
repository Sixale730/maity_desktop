'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const BORDER_COLORS = ['border-l-blue-500', 'border-l-purple-500', 'border-l-emerald-500', 'border-l-amber-500', 'border-l-pink-500'];

interface InsightsGridProps {
  feedback: CommunicationFeedbackV4;
}

export function InsightsGrid({ feedback }: InsightsGridProps) {
  const insights = feedback.insights;
  if (!insights || insights.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Insights Ocultos</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Patrones que no son obvios a simple vista.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.slice(0, 5).map((insight, i) => (
            <div
              key={i}
              className={`border-l-2 rounded-r-lg bg-muted/30 p-3 ${BORDER_COLORS[i % BORDER_COLORS.length]}`}
            >
              <p className="text-sm font-semibold text-foreground mb-1">{insight.dato}</p>
              <p className="text-xs text-muted-foreground mb-1.5">{insight.por_que}</p>
              <p className="text-xs text-emerald-400">💡 {insight.sugerencia}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
