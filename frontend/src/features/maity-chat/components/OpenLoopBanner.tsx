import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ChatThread } from '../types';

interface OpenLoopBannerProps {
  thread: ChatThread;
  onContinue: (threadId: string) => void;
}

/**
 * Amber "Ayer dejaste algo abierto" banner shown in the empty state when
 * there's at least one thread with `open=true`. The banner promotes the most
 * recent open thread (caller picks which); clicking "Continuar" makes that
 * thread active and the layout switches from empty → active state.
 */
export function OpenLoopBanner({ thread, onContinue }: OpenLoopBannerProps) {
  const { t } = useLanguage();

  return (
    <div
      className="flex items-center gap-3.5"
      style={{
        marginTop: 32,
        padding: '14px 16px',
        borderRadius: 12,
        background: 'rgba(246,179,82,0.08)',
        border: '1px solid rgba(246,179,82,0.25)',
      }}
    >
      <div
        className="grid place-items-center text-maity-amber font-geist flex-shrink-0"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'rgba(246,179,82,0.15)',
          fontSize: 18,
        }}
      >
        ↻
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="text-maity-amber font-semibold uppercase mb-px"
          style={{ fontSize: 12, letterSpacing: '0.4px' }}
        >
          {t('chat.open_loop_label', { n: 1 })}
        </div>
        <div className="text-foreground" style={{ fontSize: 14 }}>
          {t('chat.open_loop_yesterday')}: &ldquo;{thread.title}&rdquo;
        </div>
      </div>
      <button
        type="button"
        onClick={() => onContinue(thread.id)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-foreground hover:bg-card-hi transition-colors font-medium flex-shrink-0"
        style={{ fontSize: 12 }}
      >
        {t('chat.continue')}
        <ArrowRight size={13} strokeWidth={1.8} />
      </button>
    </div>
  );
}
