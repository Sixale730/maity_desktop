// Origen: web Sixale730/maity src/features/maity-chat/components (commit 3ef2914).
// Adaptaciones desktop: MaityLogo es el shim de src/shared/components/MaityLogo.tsx
// (variant "symbol" -> /logo-collapsed.png, size md = 28px); resto tal cual.
import { useLanguage } from '@/contexts/LanguageContext';
import { MaityLogo } from '@/shared/components/MaityLogo';
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
    <div className="flex-1 min-h-0 overflow-y-auto px-10 pt-8 pb-4">
      <div className="max-w-[760px] w-full mx-auto">
        {/* Marca de Maity en la misma fila que el hero (no encima): así hero +
            4 tarjetas caben sobre el composer sin scroll. En móvil se oculta
            para no robarle ancho al título. */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-2xl bg-[rgba(72,93,244,0.10)] flex-shrink-0">
            <MaityLogo variant="symbol" size="md" className="!min-w-0" />
          </div>
          {/* Hero */}
          <h1
            className="font-geist font-semibold text-foreground min-w-0"
            style={{
              margin: 0,
              fontSize: 38,
              lineHeight: 1.05,
              letterSpacing: '-1.4px',
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
        </div>
        {/* Alineado con el texto del título (56px de logo + 16px de gap). */}
        <p
          className="text-foreground/60 sm:pl-[72px]"
          style={{ fontSize: 15.5, lineHeight: 1.6, maxWidth: 612, margin: 0, marginTop: 10 }}
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
