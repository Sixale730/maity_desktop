import { useEffect, useMemo, useRef, useState } from 'react';
import { MaityLogo } from '@/shared/components/MaityLogo';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChatTurn } from './ChatTurn';
import type { ChatMessage } from '../types';

interface ChatConversationProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  isSending?: boolean;
  userFirstName?: string | null;
  onSuggestionClick?: (text: string) => void;
  /** Click handler for CTA chips on Maity turns (e.g. "Generar plan ..."). */
  onCtaClick?: (preFillContent: string) => void;
}

/**
 * Scrollable conversation column — centered max-w 760, padding 32px 40px 0.
 * Replaces ChatThreadView with the new ChatTurn rail visual. Auto-scrolls to
 * the bottom whenever a new message arrives or a send is in flight.
 *
 * CTA chips are still single-use per session, tracked locally — exactly the
 * same pattern as the old ChatThreadView.
 */
export function ChatConversation({
  messages,
  isLoading,
  isSending,
  userFirstName,
  onSuggestionClick,
  onCtaClick,
}: ChatConversationProps) {
  const { t } = useLanguage();
  const endRef = useRef<HTMLDivElement>(null);
  const [consumedCta, setConsumedCta] = useState<Set<string>>(new Set());

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending]);

  const suggestions = useMemo(
    () => [
      t('chat.suggestion_1'),
      t('chat.suggestion_2'),
      t('chat.suggestion_3'),
      t('chat.suggestion_4'),
    ],
    [t],
  );

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-foreground/60">
        {t('chat.loading_messages')}
      </div>
    );
  }

  if (messages.length === 0) {
    const greetingName = userFirstName?.trim() || 'amigo';
    return (
      <div className="flex-1 overflow-y-auto px-10 pt-8 pb-2 flex justify-center">
        <div
          className="w-full flex flex-col items-center pt-12 pb-8 gap-8 text-center"
          style={{ maxWidth: 760 }}
        >
          <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-[rgba(72,93,244,0.10)]">
            <MaityLogo variant="symbol" size="lg" className="!min-w-0" />
          </div>
          <div>
            <p className="text-foreground font-medium mb-1">
              {t('chat.hero_title', { name: greetingName })}
            </p>
            <p className="text-sm text-foreground/60">{t('chat.hero_subtitle')}</p>
          </div>
          {onSuggestionClick && (
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSuggestionClick(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-card hover:bg-card-hi text-foreground/80 hover:text-foreground border border-border transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Un turno del assistant en streaming vive en la lista como una fila cuyo
  // id empieza con `temp-assistant-`. Mientras exista, queremos el cursor
  // parpadeante en su cuerpo y suprimimos el TypingTurn standalone para no
  // mostrar dos indicadores de "escribiendo…" a la vez.
  const hasStreamingAssistant = messages.some(
    (m) => m.role === 'assistant' && m.id.startsWith('temp-assistant-'),
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-10 pt-8 flex justify-center">
      <div className="w-full" style={{ maxWidth: 760 }}>
        {messages.map((m) => (
          <ChatTurn
            key={m.id}
            message={m}
            userFirstName={userFirstName}
            ctaConsumed={consumedCta.has(m.id)}
            streaming={m.role === 'assistant' && m.id.startsWith('temp-assistant-')}
            onCtaClick={
              onCtaClick
                ? (label) => {
                    setConsumedCta((prev) => {
                      const next = new Set(prev);
                      next.add(m.id);
                      return next;
                    });
                    onCtaClick(`Sí, ${label.toLowerCase()}`);
                  }
                : undefined
            }
          />
        ))}
        {isSending && !hasStreamingAssistant && <TypingTurn />}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Minimal "Maity is typing" placeholder — same rail visual as ChatTurn. */
function TypingTurn() {
  const { t } = useLanguage();
  return (
    <div className="flex gap-4 mb-6">
      <div className="w-4 flex-shrink-0 flex flex-col items-center pt-1.5">
        <span
          className="rounded-full"
          style={{
            width: 10,
            height: 10,
            background: 'rgba(241,241,245,0.25)',
          }}
        />
        <div className="flex-1 w-px bg-border mt-0.5" />
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span
            className="font-geist font-semibold text-maity-blue"
            style={{ fontSize: 13.5, letterSpacing: '-0.2px' }}
          >
            {t('chat.role_maity')}
          </span>
        </div>
        <div className="flex gap-1 pt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" />
        </div>
      </div>
    </div>
  );
}
