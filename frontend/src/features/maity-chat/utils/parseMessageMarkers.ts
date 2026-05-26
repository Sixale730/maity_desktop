/**
 * Parser for the two markers Maity emits in assistant messages:
 *
 *   [[DOC: <título>]]   at the very start of the message → message is a
 *                       document (rendered as a card with PDF export button)
 *   [[CTA: <label>]]    at the very end of the message → render a clickable
 *                       chip that pre-fills "Sí, genera ..." when clicked
 *
 * Both markers are stripped from the visible body. Anything that doesn't
 * match the patterns is left untouched. Never throws.
 */

export interface ParsedMessage {
  /** Title from `[[DOC: ...]]` marker. Present iff the message is a document. */
  docTitle?: string;
  /** Label from `[[CTA: ...]]` marker. Present iff Maity offered a generation CTA. */
  ctaLabel?: string;
  /** Message body with both markers stripped. */
  body: string;
}

const DOC_RE = /^\s*\[\[DOC:\s*([^\]\n]+?)\s*\]\]\s*\n?/;
const CTA_RE = /\n?\s*\[\[CTA:\s*([^\]\n]+?)\s*\]\]\s*$/;

export function parseMessageMarkers(content: string): ParsedMessage {
  if (!content) return { body: '' };

  let body = content;
  let docTitle: string | undefined;
  let ctaLabel: string | undefined;

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

  return { docTitle, ctaLabel, body: body.trim() };
}
