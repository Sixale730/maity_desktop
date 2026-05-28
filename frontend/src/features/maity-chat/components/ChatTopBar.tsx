import { Brain } from 'lucide-react';
import { TopBar, URGENCY_COLOR } from '@/shared/components/shell-v5';
import { useLanguage } from '@/contexts/LanguageContext';
import { BugReportDialog } from './BugReportDialog';
import type { ChatThread } from '../types';

interface ChatTopBarProps {
  /** Null during empty state (no thread or thread with 0 messages). */
  thread: ChatThread | null;
  /** Count of persisted messages in the active thread (0 in empty state). */
  messageCount: number;
  memoriesCount: number;
  onOpenMemories: () => void;
}

function entryTypeLabel(t: ChatThread['entry_type'], lang: 'es' | 'en'): string | null {
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

/**
 * Top bar specialization for /chat. Two modes:
 *
 *  - Empty (no thread or thread has zero messages):
 *      title    = "Nueva sesión"
 *      subtitle = "Empieza a escribir o elige un punto de partida"
 *      accentDot = none
 *
 *  - Active (thread with messages):
 *      title    = thread.title
 *      subtitle = entry_type · N mensajes (+ "abierta" if open=true)
 *      accentDot = urgency color
 */
export function ChatTopBar({
  thread,
  messageCount,
  memoriesCount,
  onOpenMemories,
}: ChatTopBarProps) {
  const { language, t } = useLanguage();
  const isEmpty = !thread || messageCount === 0;

  let title: string;
  let subtitle: string | undefined;
  let accentDot: string | undefined;

  if (isEmpty) {
    title = t('chat.empty_topbar_title');
    subtitle = t('chat.empty_topbar_sub');
  } else {
    title = thread.title;
    accentDot = URGENCY_COLOR[thread.urgency ?? 'calm'];

    const typeLabel = entryTypeLabel(thread.entry_type ?? null, language);
    const subtitleBits: string[] = [];
    if (typeLabel) subtitleBits.push(typeLabel);
    subtitleBits.push(
      messageCount === 1
        ? t('chat.subtitle_messages_one')
        : t('chat.subtitle_messages_many', { n: messageCount }),
    );
    if (thread.open) subtitleBits.push(t('chat.entry_open'));
    subtitle = subtitleBits.join(' · ');
  }

  return (
    <TopBar
      accentDot={accentDot}
      title={title}
      subtitle={subtitle}
      actions={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenMemories}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-foreground hover:bg-card-hi transition-colors font-medium"
            style={{ fontSize: 12 }}
          >
            <Brain size={13} strokeWidth={1.8} className="text-maity-blue" />
            {t('chat.memories')}
            {memoriesCount > 0 && (
              <span className="text-foreground/60">· {memoriesCount}</span>
            )}
          </button>
          <BugReportDialog threadId={thread?.id ?? null} />
        </div>
      }
    />
  );
}
