import { useLanguage } from '@/contexts/LanguageContext';
import { EntryStarterCard } from './EntryStarterCard';
import { OpenLoopBanner } from './OpenLoopBanner';
import type { ChatThread, EntryType } from '../types';

interface ChatEmptyProps {
  /** Called when the user clicks a starter card body or a chip inside it.
   *  `chip` is undefined when the card body is clicked, or the chip text
   *  when a specific chip is clicked. The parent dispatches the right
   *  message text and creates the thread on first send. */
  onPickStarter: (seedText: string, entryType: EntryType, chip?: string) => void;
  /** All threads with `open=true` — the most recent one drives the banner. */
  openThreads: ChatThread[];
  /** Called when the user clicks "Continuar" on the open-loop banner. */
  onContinueOpen: (threadId: string) => void;
}

/**
 * Empty state shown when there's no active thread, or the active thread has
 * zero messages. Three blocks:
 *   1. Hero ("¿Qué te gustaría / trabajar con Maity hoy?") + subtitle
 *   2. Grid 2×2 of EntryStarterCard
 *   3. (Optional) OpenLoopBanner if any threads are open
 *
 * No date header — the TopBar above already announces "Nueva sesión". The
 * composer renders below this in MaityChatLayout; click on a card or chip
 * sends the message directly (no pre-fill), so the empty state disappears
 * once the assistant reply lands.
 */
export function ChatEmpty({ onPickStarter, openThreads, onContinueOpen }: ChatEmptyProps) {
  const { t } = useLanguage();

  // Pick the most recent open thread for the banner (threads are pre-sorted
  // by updated_at desc in listThreads).
  const openLoop = openThreads[0] ?? null;

  const starters: Array<{
    kind: string;
    hint: string;
    glyph: string;
    color: string;
    examples: string[];
    seed: string;
    entryType: EntryType;
  }> = [
    {
      kind: t('chat.starter_thinking'),
      hint: t('chat.starter_thinking_hint'),
      glyph: '·',
      color: '#485df4',
      examples: [t('chat.starter_thinking_ex_1'), t('chat.starter_thinking_ex_2'), t('chat.starter_thinking_ex_3')].filter((s) => s.trim().length > 0),
      seed: t('chat.starter_thinking_seed'),
      entryType: 'thinking',
    },
    {
      kind: t('chat.starter_decision'),
      hint: t('chat.starter_decision_hint'),
      glyph: '◇',
      color: '#ff0050',
      examples: [t('chat.starter_decision_ex_1'), t('chat.starter_decision_ex_2'), t('chat.starter_decision_ex_3')].filter((s) => s.trim().length > 0),
      seed: t('chat.starter_decision_seed'),
      entryType: 'decision',
    },
    {
      kind: t('chat.starter_rehearsal'),
      hint: t('chat.starter_rehearsal_hint'),
      glyph: '↑',
      color: '#1bea9a',
      examples: [t('chat.starter_rehearsal_ex_1'), t('chat.starter_rehearsal_ex_2'), t('chat.starter_rehearsal_ex_3')].filter((s) => s.trim().length > 0),
      seed: t('chat.starter_rehearsal_seed'),
      entryType: 'rehearsal',
    },
    {
      kind: t('chat.starter_reflection'),
      hint: t('chat.starter_reflection_hint'),
      glyph: '↻',
      color: '#f6b352',
      examples: [t('chat.starter_reflection_ex_1'), t('chat.starter_reflection_ex_2'), t('chat.starter_reflection_ex_3')].filter((s) => s.trim().length > 0),
      seed: t('chat.starter_reflection_seed'),
      entryType: 'reflection',
    },
  ];

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto flex justify-center"
      style={{ padding: '24px 56px 0' }}
    >
      <div className="w-full" style={{ maxWidth: 760 }}>
        {/* Hero */}
        <h1
          className="font-geist font-semibold text-foreground"
          style={{
            margin: 0,
            fontSize: 38,
            lineHeight: 1.05,
            letterSpacing: '-1.4px',
            marginBottom: 10,
          }}
        >
          {t('chat.empty_hero_l1')}
          <br />
          <span
            className="text-foreground/60"
            style={{ fontStyle: 'italic', fontWeight: 500 }}
          >
            {t('chat.empty_hero_l2')}
          </span>
        </h1>
        <p
          className="text-foreground/60"
          style={{ fontSize: 15.5, lineHeight: 1.6, maxWidth: 540, margin: 0 }}
        >
          {t('chat.empty_hero_sub')}
        </p>

        {/* 4 entry cards */}
        <div className="grid grid-cols-2 gap-3" style={{ marginTop: 20 }}>
          {starters.map((s) => (
            <EntryStarterCard
              key={s.entryType}
              kind={s.kind}
              hint={s.hint}
              glyph={s.glyph}
              color={s.color}
              examples={s.examples}
              onSelect={(chip) => onPickStarter(s.seed, s.entryType, chip)}
            />
          ))}
        </div>

        {/* Open loop banner — only if there are open threads */}
        {openLoop && <OpenLoopBanner thread={openLoop} onContinue={onContinueOpen} />}
      </div>
    </div>
  );
}
