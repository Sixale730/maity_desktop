import { useEffect, useRef } from 'react';
import { Dot } from '@/shared/components/shell-v5';
import { useLanguage } from '@/contexts/LanguageContext';
import { LENSES } from './lensSpec';
import type { Lens } from '../types';

interface LensPickerProps {
  current: Lens;
  open: boolean;
  onChange: (lens: Lens) => void;
  onClose: () => void;
}

/**
 * Popover that appears above the composer when the user clicks the lens
 * button. Closes on: clicking an item, clicking outside, or pressing Esc.
 *
 * The keyboard hook also handles ⌘L (and Ctrl+L) → toggle, but the toggle
 * itself is owned by the Composer because it owns the open/close state.
 */
export function LensPicker({ current, open, onChange, onClose }: LensPickerProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute z-30 w-[280px] p-2 rounded-xl bg-card border border-border-strong"
      style={{
        bottom: 'calc(100% - 6px)',
        left: 14,
        boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
      }}
      role="listbox"
      aria-label={t('chat.lens_header')}
    >
      <div
        className="text-foreground/40 uppercase font-semibold px-1.5 pt-1.5 pb-2"
        style={{ fontSize: 10, letterSpacing: '0.5px' }}
      >
        {t('chat.lens_header')}
      </div>
      {LENSES.map((l) => {
        const active = l.id === current;
        const isOpen = l.color === null;
        const dotColor = isOpen ? '#777' : (l.color as string);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => {
              onChange(l.id);
              onClose();
            }}
            role="option"
            aria-selected={active}
            className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 transition-colors"
            style={{
              background: active
                ? isOpen
                  ? 'rgba(255,255,255,0.04)'
                  : `${l.color}14`
                : 'transparent',
              border: `1px solid ${
                active
                  ? isOpen
                    ? 'hsl(var(--border-strong))'
                    : `${l.color}55`
                  : 'transparent'
              }`,
            }}
          >
            <span className="pt-1.5">
              <Dot color={dotColor} size={7} />
            </span>
            <div className="flex-1 min-w-0">
              <div
                className="font-semibold"
                style={{
                  fontSize: 12,
                  color: active && !isOpen ? (l.color as string) : 'hsl(var(--foreground))',
                }}
              >
                {t(l.labelKey)}
              </div>
              <div className="text-foreground/60 mt-0.5" style={{ fontSize: 11 }}>
                {t(l.hintKey)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
