import { ENTRY_TYPE_COLOR } from '@/shared/components/shell-v5';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ChatThread, EntryType } from '../types';

interface ActiveEntryItemProps {
  thread: ChatThread;
  active: boolean;
  onClick: () => void;
}

function entryTypeLabel(t: EntryType | null | undefined, lang: 'es' | 'en'): string | null {
  if (!t) return null;
  if (lang === 'en') {
    return {
      decision: 'Decision',
      conversation: 'Conversation',
      focus: 'Focus',
      reflection: 'Reflection',
      rehearsal: 'Rehearsal',
      thinking: 'Thinking',
    }[t];
  }
  return {
    decision: 'Decisión',
    conversation: 'Conversación',
    focus: 'Foco',
    reflection: 'Reflexión',
    rehearsal: 'Ensayo',
    thinking: 'Pensando',
  }[t];
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) {
    const m = Math.max(1, Math.floor(diffMs / 60_000));
    return `hace ${m} min`;
  }
  if (diffH < 24) return `hace ${Math.floor(diffH)} h`;
  if (diffH < 48) return 'ayer';
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/**
 * Row inside the sidebar's conversation list. Title + entry_type dot + label
 * + timestamp. Uses tokens (maity-blue, card-hi) so it responds to themes.
 */
export function ActiveEntryItem({ thread, active, onClick }: ActiveEntryItemProps) {
  const { language } = useLanguage();
  const tColor = thread.entry_type ? ENTRY_TYPE_COLOR[thread.entry_type] : 'hsl(var(--foreground) / 0.4)';
  const typeLabel = entryTypeLabel(thread.entry_type, language);
  const when = whenLabel(thread.updated_at || thread.created_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-2.5 py-2 rounded-[7px] mb-1 transition-colors',
        active
          ? 'bg-[rgba(72,93,244,0.10)] border border-[rgba(72,93,244,0.25)]'
          : 'border border-transparent hover:bg-card/40',
      ].join(' ')}
    >
      <div
        className="truncate"
        style={{
          fontSize: 12.5,
          color: active ? 'hsl(var(--foreground))' : 'hsl(var(--foreground) / 0.62)',
          fontWeight: active ? 600 : 500,
          lineHeight: 1.3,
          marginBottom: 4,
        }}
      >
        {thread.title}
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="rounded-full flex-shrink-0"
          style={{ width: 5, height: 5, background: tColor }}
        />
        {typeLabel && (
          <span
            className="text-foreground/40 uppercase"
            style={{ fontSize: 10, letterSpacing: '0.4px' }}
          >
            {typeLabel}
          </span>
        )}
        <span className="flex-1" />
        <span
          className="text-foreground/35"
          style={{ fontSize: 10 }}
        >
          {when}
        </span>
      </div>
    </button>
  );
}
