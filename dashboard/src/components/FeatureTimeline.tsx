import { Card, CardHeader, CardTitle } from './Card';
import { cycles } from '../data/metrics';

const categoryBadge: Record<string, { bg: string; text: string; label: string }> = {
  framework: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Framework' },
  feature: { bg: 'bg-brand-500/10', text: 'text-brand-400', label: 'Feature' },
  optimization: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', label: 'Optimization' },
  ui: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', label: 'UI' },
  refactor: { bg: 'bg-accent-cyan/10', text: 'text-accent-cyan', label: 'Refactor' },
};

const statusIcon: Record<string, { color: string; icon: string }> = {
  pass: { color: 'bg-accent-green', icon: '✓' },
  fail: { color: 'bg-accent-red', icon: '✕' },
  pending: { color: 'bg-accent-amber', icon: '…' },
};

export function FeatureTimeline() {
  return (
    <Card delay={0.25}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-purple/10">
          <svg className="h-3.5 w-3.5 text-accent-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
        <CardTitle>Feature Timeline</CardTitle>
        <span className="ml-auto text-xs text-gray-500">{cycles.length} ciclos</span>
      </CardHeader>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-surface-3" />

        <div className="space-y-4">
          {[...cycles].reverse().map((cycle) => {
            const badge = categoryBadge[cycle.category];
            const status = statusIcon[cycle.buildStatus];
            return (
              <div key={cycle.id} className="group relative flex gap-4 pl-0">
                {/* Dot */}
                <div className="relative z-10 mt-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                  <div className={`h-3 w-3 rounded-full ${status.color} ring-4 ring-surface-1`} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 rounded-lg border border-surface-3 bg-surface-2/50 p-3 transition-colors group-hover:border-surface-4 group-hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-gray-600">#{cycle.id}</span>
                        <h4 className="text-sm font-semibold text-white truncate">
                          {cycle.title}
                        </h4>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                        {cycle.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-gray-600">{cycle.date}</span>
                  </div>

                  {/* Metrics row */}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px]">
                    <span className="font-mono text-gray-500">
                      <span className="text-brand-400">{cycle.loc}</span> LOC
                    </span>
                    <span className="font-mono text-gray-500">
                      <span className="text-accent-cyan">{cycle.filesChanged}</span> files
                    </span>
                    {cycle.testsAdded > 0 && (
                      <span className="font-mono text-gray-500">
                        <span className="text-accent-green">+{cycle.testsAdded}</span> tests
                      </span>
                    )}
                    <span className={`font-mono ${cycle.buildStatus === 'pass' ? 'text-accent-green' : 'text-accent-red'}`}>
                      Build {cycle.buildStatus.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
