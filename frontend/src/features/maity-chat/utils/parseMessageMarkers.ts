/**
 * Parser for the markers Maity emits in assistant messages:
 *
 *   [[DOC: <título>]]   at the very start  → message is a document (PDF/MD card)
 *   [[CTA: <label>]]    at the very end    → render a clickable chip
 *   [[TASK: <text> | due:YYYY-MM-DD]]      → server persists as chat_tasks row,
 *                                            client shows an inline pill linking
 *                                            to /tasks. `| due:` is optional.
 *   [[NOTE: <content>]]                    → server persists as chat_notes row,
 *                                            inline pill linking to /notes.
 *
 * All markers are stripped from the visible body. Anything that doesn't match
 * the patterns is left untouched. Multiple TASK/NOTE markers per message are
 * allowed; DOC and CTA are at most one each.
 *
 * Never throws. Markers that fail validation (empty content, due-date in wrong
 * shape) are dropped silently — the server tolerates absence; the client never
 * shows a broken pill.
 *
 * Nota: desde que el endpoint dejó de emitir markers (web de01451/717ff05), los
 * pills se hidratan desde BD (chat_tasks/chat_notes) y este parser solo cubre
 * mensajes viejos que aún cargan los markers en su `content` (fallback legacy).
 */

export interface ParsedTask {
  description: string;
  due?: string; // YYYY-MM-DD when present
}

export interface ParsedNote {
  content: string;
}

export interface ParsedMessage {
  docTitle?: string;
  ctaLabel?: string;
  tasks: ParsedTask[];
  notes: ParsedNote[];
  body: string;
}

const DOC_RE = /^\s*\[\[DOC:\s*([^\]\n]+?)\s*\]\]\s*\n?/;
const CTA_RE = /\n?\s*\[\[CTA:\s*([^\]\n]+?)\s*\]\]\s*$/;
// TASK/NOTE markers can appear anywhere in the body; we extract them all with
// a global regex and remove each match. The capture group keeps the inner text
// so the server can persist it (server runs the same regexes — see maity-chat.ts).
const TASK_RE = /\[\[TASK:\s*([^\]\n]+?)\s*\]\]/g;
const NOTE_RE = /\[\[NOTE:\s*([^\]\n]+?)\s*\]\]/g;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Splits the inner text of a TASK marker into description + optional due date. */
function parseTaskInner(inner: string): ParsedTask | null {
  const parts = inner.split('|').map((s) => s.trim());
  const description = parts[0];
  if (!description || description.length > 500) return null;

  let due: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i];
    const match = segment.match(/^due\s*:\s*(\d{4}-\d{2}-\d{2})$/i);
    if (match && ISO_DATE_RE.test(match[1])) {
      due = match[1];
    }
  }
  return { description, due };
}

export function parseMessageMarkers(content: string): ParsedMessage {
  if (!content) return { body: '', tasks: [], notes: [] };

  let body = content;
  let docTitle: string | undefined;
  let ctaLabel: string | undefined;
  const tasks: ParsedTask[] = [];
  const notes: ParsedNote[] = [];

  const docMatch = body.match(DOC_RE);
  if (docMatch) {
    const title = docMatch[1].trim();
    if (title.length > 0 && title.length <= 120) {
      docTitle = title;
      body = body.slice(docMatch[0].length);
    }
  }

  const ctaMatch = body.match(CTA_RE);
  if (ctaMatch) {
    const label = ctaMatch[1].trim();
    if (label.length > 0 && label.length <= 80) {
      ctaLabel = label;
      body = body.slice(0, body.length - ctaMatch[0].length);
    }
  }

  // Extract TASK markers. Each match becomes a task; the marker is stripped
  // from the visible body. Cap at 10 per message to bound runaway extraction.
  const taskMatches = Array.from(body.matchAll(TASK_RE));
  for (const m of taskMatches.slice(0, 10)) {
    const parsed = parseTaskInner(m[1]);
    if (parsed) tasks.push(parsed);
  }
  body = body.replace(TASK_RE, '').trim();

  const noteMatches = Array.from(body.matchAll(NOTE_RE));
  for (const m of noteMatches.slice(0, 10)) {
    const text = m[1].trim();
    if (text.length > 0 && text.length <= 1000) {
      notes.push({ content: text });
    }
  }
  body = body.replace(NOTE_RE, '').trim();

  return { docTitle, ctaLabel, tasks, notes, body };
}
