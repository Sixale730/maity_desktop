import { Card, CardHeader, CardTitle } from './Card';
import { transcriptionProviders } from '../data/metrics';

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-accent-green/10', text: 'text-accent-green', label: 'Activo' },
  optional: { bg: 'bg-brand-500/10', text: 'text-brand-400', label: 'Opcional' },
  disabled: { bg: 'bg-gray-500/10', text: 'text-gray-500', label: 'Deshabilitado' },
};

export function TranscriptionProviders() {
  return (
    <Card delay={0.35}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-cyan/10">
          <svg className="h-3.5 w-3.5 text-accent-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <CardTitle>Transcription Providers</CardTitle>
      </CardHeader>

      <div className="space-y-3">
        {transcriptionProviders.map((provider) => {
          const badge = statusBadge[provider.status];
          const isActive = provider.status === 'active';
          return (
            <div
              key={provider.name}
              className={`rounded-lg border p-4 transition-colors ${
                isActive
                  ? 'border-accent-green/30 bg-accent-green/5'
                  : 'border-surface-3 bg-surface-2/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                    isActive ? 'bg-accent-green/20 text-accent-green' : 'bg-surface-3 text-gray-500'
                  }`}>
                    {provider.name[0]}
                  </div>
                  <div>
                    <h4 className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-gray-400'}`}>
                      {provider.name}
                    </h4>
                    <p className="font-mono text-[10px] text-gray-600">{provider.model}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                  {badge.label}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[10px] uppercase text-gray-600">Size</p>
                  <p className="font-mono text-xs font-semibold text-gray-300">{provider.size}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase text-gray-600">WER (ES)</p>
                  <p className={`font-mono text-xs font-semibold ${
                    provider.wer <= 3 ? 'text-accent-green' : provider.wer <= 4 ? 'text-accent-amber' : 'text-accent-red'
                  }`}>
                    {provider.wer}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase text-gray-600">License</p>
                  <p className="font-mono text-xs font-semibold text-gray-300">{provider.license}</p>
                </div>
              </div>

              {/* WER comparison bar */}
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full ${
                      provider.wer <= 3 ? 'bg-accent-green' : provider.wer <= 4 ? 'bg-accent-amber' : 'bg-accent-red'
                    }`}
                    style={{ width: `${100 - (provider.wer / 5) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-[9px] text-gray-600 text-right">Accuracy: {(100 - provider.wer).toFixed(1)}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
