'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const BORDER_COLORS = ['border-l-blue-500', 'border-l-purple-500', 'border-l-emerald-500', 'border-l-amber-500', 'border-l-pink-500'];

interface InsightsGridProps {
  feedback: CommunicationFeedbackV4;
}

function InsightCard({ insight, index }: { insight: { dato: string; por_que: string; sugerencia: string }; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className={`border-l-[5px] ${BORDER_COLORS[index % BORDER_COLORS.length]} bg-card border-border overflow-hidden`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 p-4 text-left cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <p className="text-sm font-semibold text-foreground flex-1">{insight.dato}</p>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-muted-foreground">{insight.por_que}</p>
          <p className="text-xs text-blue-500 font-semibold">{insight.sugerencia}</p>
        </div>
      )}
    </Card>
  );
}

export function InsightsGrid({ feedback }: InsightsGridProps) {
  const insights = feedback.insights;
  if (!insights || insights.length === 0) return null;

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-1">Insights Ocultos</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Patrones que no son obvios a simple vista.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {insights.slice(0, 5).map((insight, i) => (
          <InsightCard key={i} insight={insight} index={i} />
        ))}
      </div>
    </div>
  );
}
