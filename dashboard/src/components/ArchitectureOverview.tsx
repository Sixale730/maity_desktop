import { Card, CardHeader, CardTitle } from './Card';

const layers = [
  {
    name: 'Frontend UI',
    tech: 'Next.js 14 + React 18 + TypeScript',
    color: 'border-brand-500/40 bg-brand-500/5',
    dot: 'bg-brand-500',
    modules: ['page.tsx', 'CoachPanel', 'TranscriptPanel', 'Onboarding'],
  },
  {
    name: 'Tauri IPC Bridge',
    tech: 'Tauri 2.x Commands & Events',
    color: 'border-accent-purple/40 bg-accent-purple/5',
    dot: 'bg-accent-purple',
    modules: ['invoke()', 'emit()', 'listen()'],
  },
  {
    name: 'Rust Audio Pipeline',
    tech: 'cpal + VAD + Ring Buffer + Stereo Mix',
    color: 'border-accent-amber/40 bg-accent-amber/5',
    dot: 'bg-accent-amber',
    modules: ['pipeline.rs', 'recording_manager.rs', 'incremental_saver.rs', 'vad.rs'],
  },
  {
    name: 'Transcription Engine',
    tech: 'Parakeet (ONNX, default) + Canary (opcional)',
    color: 'border-accent-green/40 bg-accent-green/5',
    dot: 'bg-accent-green',
    modules: ['engine.rs', 'worker.rs', 'spanish_postprocess.rs'],
  },
  {
    name: 'Coach IA',
    tech: 'Ollama (local) — gemma4 / phi3.5',
    color: 'border-accent-cyan/40 bg-accent-cyan/5',
    dot: 'bg-accent-cyan',
    modules: ['coach/mod.rs', 'trigger.rs', 'meeting_type.rs', 'CoachContext.tsx'],
  },
  {
    name: 'Backend API',
    tech: 'FastAPI + SQLite + LLM Summaries',
    color: 'border-accent-red/40 bg-accent-red/5',
    dot: 'bg-accent-red',
    modules: ['main.py', 'db.py', 'llm_client.py'],
  },
];

export function ArchitectureOverview() {
  return (
    <Card delay={0.45} className="xl:col-span-2">
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-3">
          <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
        </div>
        <CardTitle>Architecture Layers</CardTitle>
      </CardHeader>

      <div className="space-y-2">
        {layers.map((layer, i) => (
          <div key={layer.name} className="relative">
            {/* Connector */}
            {i < layers.length - 1 && (
              <div className="absolute left-5 top-full z-0 h-2 w-px bg-surface-3" />
            )}
            <div className={`rounded-lg border p-3 ${layer.color}`}>
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${layer.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-white">{layer.name}</h4>
                    <span className="text-[10px] text-gray-500">{layer.tech}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {layer.modules.map((mod) => (
                      <span
                        key={mod}
                        className="rounded bg-surface-0/50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500"
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Data flow legend */}
      <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-gray-600">
        <span>▲ User Input</span>
        <span>→ IPC Events</span>
        <span>↓ Audio Stream</span>
        <span>⇄ LLM Inference</span>
      </div>
    </Card>
  );
}
