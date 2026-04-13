import { Card, CardHeader, CardTitle } from './Card';
import { improvementCandidates } from '../data/metrics';

const priorityConfig: Record<string, { color: string; bg: string; label: string }> = {
  high: { color: 'text-accent-red', bg: 'bg-accent-red/10', label: 'Alta' },
  medium: { color: 'text-accent-amber', bg: 'bg-accent-amber/10', label: 'Media' },
  low: { color: 'text-accent-green', bg: 'bg-accent-green/10', label: 'Baja' },
  future: { color: 'text-brand-400', bg: 'bg-brand-500/10', label: 'Futuro' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: 'text-gray-500', label: 'Pendiente' },
  'in-progress': { color: 'text-accent-amber', label: 'En Progreso' },
  done: { color: 'text-accent-green', label: 'Completado' },
  deferred: { color: 'text-gray-600', label: 'Diferido' },
};

export function ImprovementCandidates() {
  return (
    <Card delay={0.3}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-amber/10">
          <svg className="h-3.5 w-3.5 text-accent-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <CardTitle>Improvement Candidates</CardTitle>
        <span className="ml-auto text-xs text-gray-500">{improvementCandidates.length} items</span>
      </CardHeader>

      <div className="space-y-3">
        {improvementCandidates.map((item) => {
          const priority = priorityConfig[item.priority];
          const status = statusConfig[item.status];
          return (
            <div
              key={item.title}
              className="rounded-lg border border-surface-3 bg-surface-2/50 p-3 transition-colors hover:border-surface-4 hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${priority.bg} ${priority.color}`}>
                      {priority.label}
                    </span>
                    <h4 className="text-sm font-medium text-white">{item.title}</h4>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{item.impact}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-medium ${status.color}`}>
                  {status.label}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-600">
                <span className="font-mono">~{item.locEstimate} LOC</span>
                {item.prerequisite && (
                  <span className="truncate">Req: {item.prerequisite}</span>
                )}
              </div>

              {/* Effort bar */}
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className={`h-full rounded-full ${priority.color.replace('text-', 'bg-')}`}
                  style={{ width: `${Math.min((item.locEstimate / 2200) * 100, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
