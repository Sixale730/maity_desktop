import { Card, CardHeader, CardTitle } from './Card';
import { Expandable, ExpandableDetail } from './Expandable';
import { prompts } from '../data/metrics';

const typeConfig: Record<string, { bg: string; text: string; label: string }> = {
  system: { bg: 'bg-accent-red/10', text: 'text-accent-red', label: 'System' },
  agent: { bg: 'bg-brand-500/10', text: 'text-brand-400', label: 'Agent' },
  skill: { bg: 'bg-accent-purple/10', text: 'text-accent-purple', label: 'Skill' },
  hook: { bg: 'bg-accent-amber/10', text: 'text-accent-amber', label: 'Hook' },
};

export function PromptsPanel() {
  const grouped = {
    system: prompts.filter((p) => p.type === 'system'),
    agent: prompts.filter((p) => p.type === 'agent'),
    skill: prompts.filter((p) => p.type === 'skill'),
    hook: prompts.filter((p) => p.type === 'hook'),
  };

  return (
    <Card delay={0.2}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-purple/10">
          <svg className="h-3.5 w-3.5 text-accent-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M8 13h2" />
            <path d="M8 17h2" />
            <path d="M14 13h2" />
            <path d="M14 17h2" />
          </svg>
        </div>
        <CardTitle>Prompts & Agents</CardTitle>
        <span className="ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-mono text-gray-500">
          {prompts.length} activos
        </span>
      </CardHeader>

      {/* Type summary pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(grouped).map(([type, items]) => {
          const cfg = typeConfig[type];
          return (
            <span key={type} className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
              {cfg.label} ({items.length})
            </span>
          );
        })}
      </div>

      {/* Expandable prompts */}
      <div className="space-y-2">
        {prompts.map((prompt) => {
          const cfg = typeConfig[prompt.type];
          return (
            <Expandable
              key={prompt.id}
              title={prompt.name}
              subtitle={`Usado en ${prompt.usedIn.length} sesion${prompt.usedIn.length > 1 ? 'es' : ''}`}
              badge={
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${cfg.bg} ${cfg.text}`}>
                  {cfg.label}
                </span>
              }
            >
              {/* Prompt content */}
              <div className="rounded-md bg-surface-0/80 p-3 mb-3">
                <p className="text-xs text-gray-400 leading-relaxed font-mono whitespace-pre-wrap">
                  {prompt.content}
                </p>
              </div>

              <ExpandableDetail label="Tipo" value={prompt.type.toUpperCase()} />
              <ExpandableDetail label="Ultima vez" value={prompt.lastUsed} mono />
              <ExpandableDetail
                label="Sesiones"
                value={prompt.usedIn.join(', ')}
                mono
              />
            </Expandable>
          );
        })}
      </div>
    </Card>
  );
}
