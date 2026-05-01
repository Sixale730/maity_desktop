'use client';
import { useState } from 'react';
import type { CommunicationFeedbackV4, InsightItem } from './types';

function InsightCard({ insight }: { insight: InsightItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`insight-card${open ? ' open' : ''}`}>
      <div className="insight-dato" onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        {insight.dato}
      </div>
      <div className="insight-details">
        {insight.por_que && <p className="insight-por-que">{insight.por_que}</p>}
        {insight.sugerencia && <p className="insight-sugerencia">💡 {insight.sugerencia}</p>}
      </div>
    </div>
  );
}

export function InsightsGrid({ feedback }: { feedback: CommunicationFeedbackV4 }) {
  const insights = feedback.insights;
  if (!insights || insights.length === 0) return null;
  return (
    <div id="dv1-insights" className="insights-grid">
      {insights.map((insight, i) => (
        <InsightCard key={i} insight={insight} />
      ))}
    </div>
  );
}
