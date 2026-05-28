import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  CheckSquare,
  FileDown,
  FileText,
  Loader2,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { PDFService } from '@maity/shared';
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
  const isMaity = message.role === 'assistant';
  const parsed = parseMessageMarkers(message.content);
  const { docTitle, ctaLabel, body } = parsed;
  // Los pills vienen de las filas que las tools crearon (hidratadas en el
  // mensaje por el service). Fallback al marker-parsing para mensajes que
  // preceden a tool-use (su content aún carga [[TASK:]]/[[NOTE:]]).
  const tasks = message.tasks ?? parsed.tasks;
  const notes = message.notes ?? parsed.notes;
  const role = isMaity ? t('chat.role_maity') : t('chat.role_me');
  const time = formatTime(message.created_at);

  const dotColor = move ? move.color : 'rgba(241,241,245,0.25)';

  const handleExport = async () => {
    if (!docTitle) return;
    setExporting(true);
    try {
      await PDFService.generateChatDocumentPDF({
        title: docTitle,
        content: body,
        userName: userFirstName ?? undefined,
        generatedAt: new Date(message.created_at),
      });
    } catch {
      toast.error(t('chat.export_failed'));
    } finally {
      setExporting(false);
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

        {docTitle ? (
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
                {docTitle}
              </p>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-maity-blue hover:opacity-90 disabled:opacity-50 text-white transition-opacity"
              >
                {exporting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileDown className="w-3 h-3" />
                )}
                {exporting ? t('chat.exporting') : t('chat.download_pdf')}
              </button>
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
                {body}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <div
            className={[
              'prose prose-sm dark:prose-invert max-w-none',
              isMaity ? 'font-geist' : 'font-inter',
              '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_h1]:mt-2 [&_h2]:mt-2',
              streaming ? 'after:content-["▋"] after:ml-0.5 after:animate-pulse' : '',
            ].join(' ')}
            style={{ fontSize: 15, lineHeight: 1.7, color: 'hsl(var(--foreground))' }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markComponents}>
              {body}
            </ReactMarkdown>
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
