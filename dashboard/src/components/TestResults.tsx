import { CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './Card';
import { testModules, totalStats } from '../data/metrics';

const categoryColors: Record<string, string> = {
  coach: 'bg-brand-500',
  transcription: 'bg-accent-cyan',
  audio: 'bg-accent-purple',
  postprocess: 'bg-accent-amber',
  other: 'bg-gray-500',
};

export function TestResults() {
  return (
    <Card delay={0.15} className="col-span-1">
      <CardHeader>
        <FlaskIcon />
        <CardTitle>Test Results</CardTitle>
        <span className="ml-auto rounded-full bg-accent-green/10 px-2.5 py-0.5 text-xs font-semibold text-accent-green">
          {totalStats.testPassRate}% Pass
        </span>
      </CardHeader>

      {/* Summary Ring */}
      <div className="mb-5 flex items-center justify-center">
        <div className="relative h-32 w-32">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60" cy="60" r="50"
              fill="none" stroke="currentColor"
              className="text-surface-3"
              strokeWidth="8"
            />
            <circle
              cx="60" cy="60" r="50"
              fill="none" stroke="currentColor"
              className="text-accent-green"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(totalStats.testPassRate / 100) * 314.16} 314.16`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">{totalStats.totalTests}</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">tests</span>
          </div>
        </div>
      </div>

      {/* Module Breakdown */}
      <div className="space-y-3">
        {testModules.map((mod) => (
          <div key={mod.module} className="group">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {mod.failed === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent-green" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-accent-red" />
                )}
                <span className="text-xs font-medium text-gray-300">{mod.name}</span>
              </div>
              <span className="font-mono text-xs text-gray-500">
                {mod.passed}/{mod.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-all ${
                  mod.failed === 0 ? 'bg-accent-green' : 'bg-accent-red'
                }`}
                style={{ width: `${(mod.passed / mod.total) * 100}%` }}
              />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${categoryColors[mod.category]}`}
              />
              <span className="font-mono text-[10px] text-gray-600">{mod.module}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FlaskIcon() {
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-green/10">
      <svg className="h-3.5 w-3.5 text-accent-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6M12 3v7.4c0 .3.1.5.3.7l5.4 7.2c.8 1.1.1 2.7-1.2 2.7H7.5c-1.3 0-2-1.6-1.2-2.7l5.4-7.2c.2-.2.3-.4.3-.7V3" />
      </svg>
    </div>
  );
}
