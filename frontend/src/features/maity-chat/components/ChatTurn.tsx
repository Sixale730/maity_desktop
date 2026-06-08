import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Check,
  CheckSquare,
  ClipboardCopy,
  FileCode2,
  FileDown,
  FileText,
  Loader2,
  Presentation,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { PDFService, PptxService } from '@maity/shared';
import { Dot } from '@/shared/components/shell-v5';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseMessageMarkers } from '../utils/parseMessageMarkers';
import { ChatMark } from './ChatMark';
import type { ChatMessage } from '../types';

// Colores de los pills por destino. El web usa ROUTE_COLOR de shell-v6 (no
// existe en el shell-v5 del desktop), así que los fijamos localmente. Se usan
// como hex+alpha (`${color}1a` fondo, `${color}44` borde).
const PILL_TASK_COLOR = '#10B981'; // emerald — tareas (/tasks)
const PILL_NOTE_COLOR = '#F59E0B'; // amber — notas (/notes)

/** Construye el slug de un archivo `.md` a partir del título del documento.
 *  Quita diacríticos + no-alfanuméricos, colapsa espacios a `-`, y limita el
 *  largo para que el diálogo de guardado del SO quede legible. Cae a
 *  "documento" cuando el título se resuelve a vacío. */
const slugify = (s: string): string => {
  const norm = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = norm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'documento';
};

export interface ChatTurnMove {
  /** Short uppercase label (e.g. "PREGUNTA", "REFLEJO + RETO"). */
  label: string;
  /** Hex color of the dot + label. */
  color: string;
}

interface ChatTurnProps {
  message: ChatMessage;
  /** Pass-through for PDF generation header. */
  userFirstName?: string | null;
  /** When this message offered a CTA and the user already clicked it, mark
   * the chip consumed so it can't be triggered twice. */
  ctaConsumed?: boolean;
  /** Handler when the user clicks the CTA chip. */
  onCtaClick?: (label: string) => void;
  /** Optional "move" tag (color + uppercase label). Only set for Maity turns.
   * Stays undefined until the LLM emits move markers in a future PR. */
  move?: ChatTurnMove;
  /** Is this the last turn of an in-flight stream? Currently unused (kept for
   * the future blinking-cursor end-of-stream UX described in the handoff). */
  streaming?: boolean;
}

/**
 * One turn of the conversation. Left rail (dot + line) on every row, role
 * label + optional movement + timestamp, then body. Maity speaks in Geist,
 * the user speaks in Inter — sustains the "two voices" feel from the handoff.
 *
 * Preserves the DOC + CTA marker handling from the previous MessageBubble:
 * - [[DOC: title]] at start  → render a doc card with PDF export button
 * - [[CTA: label]] at end    → render a clickable chip below the body
 * - ==highlight==            → wrap in <ChatMark> (amber pen swipe)
 */
export function ChatTurn({
  message,
  userFirstName,
  ctaConsumed,
  onCtaClick,
  move,
  streaming,
}: ChatTurnProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadingPptx, setDownloadingPptx] = useState(false);
  const isMaity = message.role === 'assistant';
  const parsed = parseMessageMarkers(message.content);
  const { docTitle, ctaLabel, body } = parsed;
  // El spec de presentación lo produce el tool create_presentation y se
  // persiste en el mensaje (`artifact`), no se parsea del texto.
  const deckSpec = message.artifact?.type === 'deck' ? message.artifact.spec : undefined;
  // El spec de documento viene del tool create_document. Tiene prioridad sobre
  // el marcador legacy `[[DOC:]]` — el marcador solo aplica a mensajes previos a
  // la migración a tool. Forzar la salida estructurada vía tool elimina el modo
  // de fallo "el modelo envolvió el marcador en un lead-in".
  const docSpec = message.artifact?.type === 'document' ? message.artifact.spec : undefined;
  const effectiveDocTitle = docSpec?.title ?? docTitle;
  const effectiveDocContent = docSpec?.content ?? body;
  // Los pills vienen de las filas que las tools crearon (hidratadas en el
  // mensaje por el service). Fallback al marker-parsing para mensajes que
  // preceden a tool-use (su content aún carga [[TASK:]]/[[NOTE:]]).
  const tasks = message.tasks ?? parsed.tasks;
  const notes = message.notes ?? parsed.notes;
  const role = isMaity ? t('chat.role_maity') : t('chat.role_me');
  const time = formatTime(message.created_at);
  // Documentos que el usuario adjuntó en este turno — chips read-only pegados
  // a la burbuja (mismo estilo del chip del composer, sin botón de quitar).
  const userAttachments = !isMaity ? (message.attachments ?? []) : [];

  const dotColor = move ? move.color : 'rgba(241,241,245,0.25)';

  const handleExport = async () => {
    if (!effectiveDocTitle) return;
    setExporting(true);
    try {
      await PDFService.generateChatDocumentPDF({
        title: effectiveDocTitle,
        content: effectiveDocContent,
        userName: userFirstName ?? undefined,
        generatedAt: new Date(message.created_at),
      });
    } catch {
      toast.error(t('chat.export_failed'));
    } finally {
      setExporting(false);
    }
  };

  /** Markdown plano para exportar — título como H1 + body tal cual. Evita
   *  filtrar sintaxis de marcadores; pega bien en email, LinkedIn, Notion. */
  const markdownPayload = (): string => {
    if (!effectiveDocTitle) return effectiveDocContent;
    return `# ${effectiveDocTitle}\n\n${effectiveDocContent}`.trim();
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownPayload());
      setCopied(true);
      toast.success(t('chat.copy_success'));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('chat.copy_failed'));
    }
  };

  const handleDownloadMarkdown = () => {
    const filename = `${slugify(effectiveDocTitle ?? 'documento')}.md`;
    const blob = new Blob([markdownPayload()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** Construye + descarga el .pptx. pptxgenjs se lazy-loadea dentro de
   *  PptxService, así que la lib pesada solo se carga cuando el usuario hace clic. */
  const handleDownloadPptx = async () => {
    if (!deckSpec) return;
    setDownloadingPptx(true);
    try {
      await PptxService.generateDeck(deckSpec);
    } catch {
      toast.error(t('chat.export_failed'));
    } finally {
      setDownloadingPptx(false);
    }
  };

  return (
    <div className="flex gap-4 mb-6">
      {/* Left rail */}
      <div className="w-4 flex-shrink-0 flex flex-col items-center pt-1.5">
        <Dot color={dotColor} size={10} glow={!!move} />
        <div className="flex-1 w-px bg-border mt-0.5" />
      </div>

      {/* Right column */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span
            className="font-geist font-semibold"
            style={{
              fontSize: 13.5,
              letterSpacing: '-0.2px',
              color: isMaity ? 'hsl(var(--maity-blue))' : 'hsl(var(--foreground))',
            }}
          >
            {role}
          </span>
          {move && (
            <span
              className="font-semibold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.5px', color: move.color }}
            >
              · {move.label}
            </span>
          )}
          <span className="text-foreground/40" style={{ fontSize: 11 }}>
            {time}
          </span>
        </div>

        {deckSpec ? (
          <div
            className="rounded-xl bg-card border-2 overflow-hidden"
            style={{ borderColor: 'rgba(255,0,80,0.30)' }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ background: 'rgba(255,0,80,0.05)' }}
            >
              <Presentation
                className="w-4 h-4 flex-shrink-0"
                style={{ color: '#FF0050' }}
                strokeWidth={1.8}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{deckSpec.title}</p>
                <p className="text-foreground/50" style={{ fontSize: 11 }}>
                  {deckSpec.slides.length} {t('chat.deck_slides')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadPptx}
                disabled={downloadingPptx}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full hover:opacity-90 disabled:opacity-50 text-white transition-opacity flex-shrink-0"
                style={{ background: '#FF0050' }}
              >
                {downloadingPptx ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileDown className="w-3 h-3" />
                )}
                {downloadingPptx ? t('chat.exporting') : t('chat.download_pptx')}
              </button>
            </div>
          </div>
        ) : effectiveDocTitle ? (
          <div
            className="rounded-xl bg-card border-2 overflow-hidden"
            style={{ borderColor: 'rgba(72,93,244,0.30)' }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{
                background: 'rgba(72,93,244,0.05)',
                borderColor: 'rgba(72,93,244,0.20)',
              }}
            >
              <FileText className="w-4 h-4 text-maity-blue flex-shrink-0" strokeWidth={1.8} />
              <p className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">
                {effectiveDocTitle}
              </p>
              <div className="flex-shrink-0 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  title={t('chat.copy_markdown')}
                  aria-label={t('chat.copy_markdown')}
                  className="w-7 h-7 grid place-items-center rounded-full border border-border text-foreground/70 hover:text-foreground hover:bg-card-hi transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <ClipboardCopy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMarkdown}
                  title={t('chat.download_markdown')}
                  aria-label={t('chat.download_markdown')}
                  className="w-7 h-7 grid place-items-center rounded-full border border-border text-foreground/70 hover:text-foreground hover:bg-card-hi transition-colors"
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-maity-blue hover:opacity-90 disabled:opacity-50 text-white transition-opacity"
                >
                  {exporting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                  {exporting ? t('chat.exporting') : t('chat.download_pdf')}
                </button>
              </div>
            </div>
            <div
              className={[
                'px-4 py-3 prose prose-sm dark:prose-invert max-w-none',
                isMaity ? 'font-geist' : 'font-inter',
                '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1',
              ].join(' ')}
              style={{ fontSize: 15, lineHeight: 1.7, color: 'hsl(var(--foreground))' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markComponents}>
                {effectiveDocContent}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <div
            className={[
              'prose prose-sm dark:prose-invert max-w-none',
              isMaity ? 'font-geist' : 'font-inter',
              '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_h1]:mt-2 [&_h2]:mt-2',
            ].join(' ')}
            style={{ fontSize: 15, lineHeight: 1.7, color: 'hsl(var(--foreground))' }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markComponents}>
              {body}
            </ReactMarkdown>
            {streaming && (
              <div
                className="flex items-center gap-1.5 mt-1.5 text-foreground/50"
                role="status"
                aria-label={t('chat.streaming')}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                <span style={{ fontSize: 11.5 }}>{t('chat.streaming')}</span>
              </div>
            )}
          </div>
        )}

        {userAttachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {userAttachments.map((a, i) => (
              <span
                key={`att-${i}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card-hi border border-border text-foreground/80"
                style={{ fontSize: 11.5 }}
                title={a.filename}
              >
                <FileText size={12} strokeWidth={1.8} className="flex-shrink-0 text-foreground/50" />
                <span className="max-w-[12rem] truncate">{a.filename}</span>
              </span>
            ))}
          </div>
        )}

        {ctaLabel && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onCtaClick?.(ctaLabel)}
              disabled={ctaConsumed || !onCtaClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[rgba(72,93,244,0.10)] hover:bg-[rgba(72,93,244,0.18)] disabled:opacity-50 disabled:cursor-not-allowed text-maity-blue font-medium transition-colors border border-[rgba(72,93,244,0.30)]"
              style={{ fontSize: 12 }}
            >
              <Sparkles className="w-3 h-3" />
              {ctaLabel}
            </button>
          </div>
        )}

        {/* Pills de confirmación de tareas/notas que Maity persistió en este
            turno. Cada pill enlaza a su página destino para que el usuario
            verifique la fila. No se necesita id: los más recientes aparecen
            primero en /tasks y /notes. */}
        {(tasks.length > 0 || notes.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tasks.map((task, i) => (
              <button
                key={`task-${i}`}
                type="button"
                onClick={() => router.push('/tasks')}
                title={task.description}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
                style={{
                  fontSize: 11.5,
                  background: `${PILL_TASK_COLOR}1a`,
                  borderColor: `${PILL_TASK_COLOR}44`,
                  color: PILL_TASK_COLOR,
                }}
              >
                <CheckSquare className="w-3 h-3" strokeWidth={1.8} />
                <span className="font-semibold uppercase" style={{ letterSpacing: '0.3px' }}>
                  {t('chat.pill_task_saved')}
                </span>
                <span
                  className="max-w-[18rem] truncate font-medium"
                  style={{ color: 'hsl(var(--foreground) / 0.78)' }}
                >
                  {task.description}
                </span>
                {task.due && <span className="text-foreground/40">· {task.due}</span>}
                <ArrowUpRight className="w-3 h-3" strokeWidth={1.8} />
              </button>
            ))}
            {notes.map((note, i) => (
              <button
                key={`note-${i}`}
                type="button"
                onClick={() => router.push('/notes')}
                title={note.content}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
                style={{
                  fontSize: 11.5,
                  background: `${PILL_NOTE_COLOR}1a`,
                  borderColor: `${PILL_NOTE_COLOR}44`,
                  color: PILL_NOTE_COLOR,
                }}
              >
                <StickyNote className="w-3 h-3" strokeWidth={1.8} />
                <span className="font-semibold uppercase" style={{ letterSpacing: '0.3px' }}>
                  {t('chat.pill_note_saved')}
                </span>
                <span
                  className="max-w-[18rem] truncate font-medium"
                  style={{ color: 'hsl(var(--foreground) / 0.78)' }}
                >
                  {note.content}
                </span>
                <ArrowUpRight className="w-3 h-3" strokeWidth={1.8} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Render `==text==` highlights as <ChatMark>. We delegate to a `<mark>` HTML
 * element (which remark-gfm doesn't emit by default) by pre-rewriting the
 * markdown — but doing that pre-render mutates text inside code blocks too.
 *
 * Cleaner approach: a custom <p>/<li>/<strong>/<em> renderer that scans text
 * nodes for the `==...==` pattern at the React level. Code blocks render via
 * <code>/<pre> which we don't touch.
 */
function renderTextWithMarks(text: string): ReactNode {
  if (!text.includes('==')) return text;
  const parts: ReactNode[] = [];
  const re = /==(.+?)==/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<ChatMark key={`mk-${m.index}`}>{m[1]}</ChatMark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function walkChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return renderTextWithMarks(children);
  if (Array.isArray(children)) return children.map((c) => walkChildren(c));
  return children;
}

const markComponents: Components = {
  p: ({ children }) => <p>{walkChildren(children)}</p>,
  li: ({ children }) => <li>{walkChildren(children)}</li>,
  strong: ({ children }) => <strong>{walkChildren(children)}</strong>,
  em: ({ children }) => <em>{walkChildren(children)}</em>,
};
