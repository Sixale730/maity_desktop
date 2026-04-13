import { useState } from 'react';
import { Card, CardHeader, CardTitle } from './Card';
import { Expandable, ExpandableDetail } from './Expandable';
import { conversations, prompts } from '../data/metrics';

const tipCategoryConfig: Record<string, { bg: string; text: string; icon: string }> = {
  optimization: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', icon: '⚡' },
  architecture: { bg: 'bg-brand-500/10', text: 'text-brand-400', icon: '🏗' },
  testing: { bg: 'bg-accent-green/10', text: 'text-accent-green', icon: '🧪' },
  security: { bg: 'bg-accent-red/10', text: 'text-accent-red', icon: '🔒' },
  ux: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', icon: '🎨' },
  performance: { bg: 'bg-accent-cyan/10', text: 'text-accent-cyan', icon: '🚀' },
};

type TabId = 'all' | 'tips' | 'prompts' | 'files';

export function ConversationLog() {
  const [activeTab, setActiveTab] = useState<TabId>('all');

  return (
    <Card delay={0.25} className="xl:col-span-2">
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/10">
          <svg className="h-3.5 w-3.5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <CardTitle>Conversaciones</CardTitle>
        <span className="ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-mono text-gray-500">
          {conversations.length} sesiones
        </span>
      </CardHeader>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-surface-0/50 p-1">
        {[
          { id: 'all' as const, label: 'Todo' },
          { id: 'tips' as const, label: 'Tips' },
          { id: 'prompts' as const, label: 'Prompts' },
          { id: 'files' as const, label: 'Archivos' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-surface-3 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversations */}
      <div className="space-y-3">
        {[...conversations].reverse().map((conv) => (
          <Expandable
            key={conv.id}
            title={conv.title}
            subtitle={`${conv.date} · ${conv.duration} · ${conv.cyclesCompleted} ciclos · ${(conv.tokensUsed / 1000).toFixed(0)}k tokens`}
            badge={
              <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-[9px] font-bold text-accent-green">
                {conv.tips.filter((t) => t.applied).length}/{conv.tips.length} tips aplicados
              </span>
            }
            defaultOpen={conv.id === conversations[conversations.length - 1].id}
          >
            {/* Summary */}
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              {conv.summary}
            </p>

            {/* Tips Section */}
            {(activeTab === 'all' || activeTab === 'tips') && (
              <div className="mb-4">
                <h5 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
                  Tips & Decisiones ({conv.tips.length})
                </h5>
                <div className="space-y-2">
                  {conv.tips.map((tip, i) => {
                    const cfg = tipCategoryConfig[tip.category];
                    return (
                      <div
                        key={i}
                        className={`rounded-md border p-2.5 transition-colors ${
                          tip.applied
                            ? 'border-surface-3 bg-surface-0/50'
                            : 'border-accent-amber/20 bg-accent-amber/5'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 text-sm mt-0.5">{cfg.icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-gray-300 leading-relaxed">{tip.text}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${cfg.bg} ${cfg.text}`}>
                                {tip.category}
                              </span>
                              {tip.applied ? (
                                <span className="text-[9px] text-accent-green font-medium">Aplicado</span>
                              ) : (
                                <span className="text-[9px] text-accent-amber font-medium">Pendiente</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Prompts Used */}
            {(activeTab === 'all' || activeTab === 'prompts') && (
              <div className="mb-4">
                <h5 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
                  Prompts Usados ({conv.promptsUsed.length})
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {conv.promptsUsed.map((promptId) => {
                    const prompt = prompts.find((p) => p.id === promptId);
                    if (!prompt) return null;
                    const cfg = {
                      system: 'bg-accent-red/10 text-accent-red border-accent-red/20',
                      agent: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
                      skill: 'bg-accent-purple/10 text-accent-purple border-accent-purple/20',
                      hook: 'bg-accent-amber/10 text-accent-amber border-accent-amber/20',
                    }[prompt.type];
                    return (
                      <span
                        key={promptId}
                        className={`rounded-md border px-2 py-1 text-[10px] font-medium ${cfg}`}
                      >
                        {prompt.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files Modified */}
            {(activeTab === 'all' || activeTab === 'files') && (
              <div>
                <h5 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
                  Archivos Modificados ({conv.filesModified.length})
                </h5>
                <div className="max-h-32 overflow-y-auto space-y-1 rounded-md bg-surface-0/80 p-2">
                  {conv.filesModified.map((file) => {
                    const isRust = file.endsWith('.rs');
                    const isTs = file.endsWith('.tsx') || file.endsWith('.ts');
                    const isMd = file.endsWith('.md');
                    const color = isRust ? 'text-accent-amber' : isTs ? 'text-brand-400' : isMd ? 'text-accent-green' : 'text-gray-400';
                    return (
                      <div key={file} className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isRust ? 'bg-accent-amber' : isTs ? 'bg-brand-500' : isMd ? 'bg-accent-green' : 'bg-gray-500'
                        }`} />
                        <span className={`font-mono text-[10px] ${color} truncate`}>
                          {file}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer stats */}
            <div className="mt-3 pt-3 border-t border-surface-3 flex items-center gap-4">
              <ExpandableDetail label="Duracion" value={conv.duration} />
              <ExpandableDetail label="Tokens" value={`${(conv.tokensUsed / 1000).toFixed(0)}k`} mono />
              <ExpandableDetail label="Ciclos" value={String(conv.cyclesCompleted)} />
            </div>
          </Expandable>
        ))}
      </div>
    </Card>
  );
}
