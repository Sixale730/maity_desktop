import {
  ChangeEvent,
  forwardRef,
  KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  Eye,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  SendHorizontal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { extractDocument, DocumentExtractError } from '../utils/extractDocument';
import { LensPicker } from './LensPicker';
import { LENSES } from './lensSpec';
import type { Lens } from '../types';

export interface ComposerAttachment {
  filename: string;
  text: string;
}

/** Máximo de adjuntos por turno (igual que el web). */
const MAX_ATTACHMENTS = 3;

const ATTACH_ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt,.md';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  isSending?: boolean;
  lens: Lens;
  onLensChange: (lens: Lens) => void;
  /** Adjuntos del turno (estado dueño = MaityChatLayout). */
  attachments?: ComposerAttachment[];
  onAttachmentsChange?: (next: ComposerAttachment[]) => void;
}

/**
 * Sticky composer at the bottom of the conversation column. The lens picker
 * is hidden behind a small trigger button — most users won't touch it, which
 * is by design (the README explicitly calls this out).
 *
 * Keyboard:
 *  - Enter           → send (Shift+Enter inserts newline)
 *  - ⌘L / Ctrl+L     → toggle the lens picker
 */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    disabled,
    isSending,
    lens,
    onLensChange,
    attachments = [],
    onAttachmentsChange,
  },
  externalRef,
) {
  const { t } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset el input para que re-seleccionar el mismo archivo vuelva a disparar.
    e.target.value = '';
    if (!file || !onAttachmentsChange) return;

    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(t('chat.attachment_max'));
      return;
    }

    setExtracting(true);
    try {
      const { filename, text } = await extractDocument(file);
      onAttachmentsChange([...attachments, { filename, text }]);
    } catch (err) {
      const code = err instanceof DocumentExtractError ? err.code : 'failed';
      toast.error(t(`chat.attachment_error.${code}`));
    } finally {
      setExtracting(false);
    }
  };

  const removeAttachment = (i: number) => {
    if (!onAttachmentsChange) return;
    onAttachmentsChange(attachments.filter((_, idx) => idx !== i));
  };
  // Expose the textarea node to the parent so it can call `.focus()` after
  // pre-filling the input from a starter card click. We don't expose a
  // narrow imperative API because parents only need standard DOM focus.
  useImperativeHandle(externalRef, () => textareaRef.current as HTMLTextAreaElement, []);
  const L = LENSES.find((l) => l.id === lens) ?? LENSES[0];
  const isOpenLens = L.color === null;
  const accent = (L.color ?? 'transparent') as string;

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setPickerOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="sticky bottom-0 pt-6 pb-5 px-10 relative"
      style={{
        background:
          'linear-gradient(180deg, transparent 0%, hsl(var(--background)) 30%)',
      }}
    >
      <div className="max-w-[760px] w-full mx-auto relative">
        <LensPicker
          current={lens}
          open={pickerOpen}
          onChange={onLensChange}
          onClose={() => setPickerOpen(false)}
        />

        <div
          className="rounded-2xl bg-card border border-border p-3.5"
          style={{
            borderTop: isOpenLens ? '1px solid hsl(var(--border))' : `2px solid ${accent}`,
          }}
        >
          {/* Chips de adjuntos (texto extraído, no se persiste) */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {attachments.map((att, i) => (
                <span
                  key={`${att.filename}-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card-hi border border-border text-foreground/80"
                  style={{ fontSize: 11.5 }}
                  title={att.filename}
                >
                  <FileText size={12} strokeWidth={1.8} className="text-maity-blue flex-shrink-0" />
                  <span className="max-w-[14rem] truncate">{att.filename}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="text-foreground/40 hover:text-foreground transition-colors"
                    aria-label={t('chat.attachment_remove')}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('chat.composer_placeholder')}
            rows={2}
            disabled={disabled}
            className="w-full resize-none bg-transparent text-foreground placeholder:text-foreground/40 outline-none disabled:opacity-50"
            style={{ fontSize: 14.5, minHeight: 44, lineHeight: 1.55 }}
          />

          <div className="flex items-center gap-2 mt-2">
            {/* Lens trigger */}
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                fontSize: 11.5,
                background: isOpenLens ? 'transparent' : `${accent}14`,
                border: `1px solid ${isOpenLens ? 'hsl(var(--border))' : `${accent}44`}`,
                color: isOpenLens ? 'rgba(241,241,245,0.62)' : accent,
              }}
              title={t('chat.lens_header')}
            >
              <Eye size={11} strokeWidth={1.8} />
              {t(L.labelKey)}
              <ChevronDown size={9} strokeWidth={2} />
            </button>

            <button
              type="button"
              className="w-7 h-7 rounded-md grid place-items-center text-foreground/60 hover:text-foreground hover:bg-card-hi transition-colors"
              title={t('chat.voice')}
            >
              <Mic size={14} strokeWidth={1.8} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACH_ACCEPT}
              hidden
              onChange={handleFilePick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting || attachments.length >= MAX_ATTACHMENTS}
              className="w-7 h-7 rounded-md grid place-items-center text-foreground/60 hover:text-foreground hover:bg-card-hi transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('chat.attach')}
            >
              {extracting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Paperclip size={14} strokeWidth={1.8} />
              )}
            </button>

            <div className="flex-1" />

            <span className="text-foreground/40 hidden sm:inline" style={{ fontSize: 11 }}>
              {t('chat.composer_hint_send')}
            </span>

            <button
              type="button"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{
                fontSize: 12,
                background: isOpenLens
                  ? 'linear-gradient(135deg,#485df4,#5a6dff)'
                  : accent,
                boxShadow: isOpenLens
                  ? '0 4px 14px rgba(72,93,244,0.35)'
                  : `0 4px 14px ${accent}55`,
              }}
              aria-label={t('chat.send')}
            >
              {isSending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <SendHorizontal size={13} strokeWidth={2} />
              )}
              {t('chat.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
