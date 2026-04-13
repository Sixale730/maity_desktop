import { Card, CardHeader, CardTitle } from './Card';
import { sessionSummaries } from '../data/metrics';

export function SessionLog() {
  return (
    <Card delay={0.4}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/10">
          <svg className="h-3.5 w-3.5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </svg>
        </div>
        <CardTitle>Session Log</CardTitle>
      </CardHeader>

      <div className="space-y-4">
        {[...sessionSummaries].reverse().map((session) => (
          <div key={session.date} className="rounded-lg border border-surface-3 bg-surface-2/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                <span className="text-sm font-semibold text-white">{session.date}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span>{session.cyclesCompleted} ciclos</span>
                <span>{session.totalLoc} LOC</span>
                <span>{session.totalTests} tests</span>
              </div>
            </div>

            <ul className="space-y-1.5">
              {session.highlights.map((highlight, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
