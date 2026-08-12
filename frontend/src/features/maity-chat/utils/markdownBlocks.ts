/**
 * Parser mínimo de markdown → bloques/spans, para renderizar los documentos del
 * chat en PDF (`chat-document-pdf.tsx`).
 *
 * Por qué a mano y no con remark: `react-markdown` está instalado, pero sus
 * dependencias de parseo (`remark-parse`, `unified`, `mdast-util-*`) son
 * transitivas privadas y pnpm no las hoistea, así que no son importables. Aunque
 * lo fueran, seguiría haciendo falta escribir el mapeo mdast → primitivas de
 * react-pdf, que es el grueso del trabajo — y `==resaltado==` es una extensión
 * propia de Maity que remark no parsea (ChatTurn.tsx ya la maneja a mano en el
 * render del DOM por la misma razón).
 *
 * El contenido viene del tool `create_document`, así que el subconjunto de
 * markdown es acotado y predecible.
 *
 * Sin dependencias ni JSX a propósito: se testea puro, sin cargar react-pdf.
 */

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list-item'; marker: string; text: string; depth: number }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

export type MdSpan =
  | { kind: 'text' | 'bold' | 'italic' | 'code' | 'mark'; text: string }
  | { kind: 'link'; text: string; href: string };

const RE_FENCE = /^\s*```/;
const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/;
/** Fila separadora de tablas GFM: `|---|:--:|`. Se descarta. */
const RE_TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Divide el markdown en bloques. Las líneas consecutivas de texto plano se unen
 * con espacio (semántica de soft-break de markdown), igual que se ve en pantalla
 * con react-markdown.
 */
export function parseMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ kind: 'quote', text: quote.join(' ').trim() });
      quote = [];
    }
  };
  const flushSoft = () => {
    flushParagraph();
    flushQuote();
  };

  for (const line of lines) {
    // Dentro de un fence nada más aplica: se acumula verbatim.
    if (code !== null) {
      if (RE_FENCE.test(line)) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    if (RE_FENCE.test(line)) {
      flushSoft();
      code = [];
      continue;
    }

    if (!line.trim()) {
      flushSoft();
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      flushSoft();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2].trim() });
      continue;
    }

    const list = RE_LIST.exec(line);
    if (list) {
      flushSoft();
      const indent = list[1].replace(/\t/g, '  ').length;
      const raw = list[2];
      const ordered = /\d/.test(raw);
      blocks.push({
        kind: 'list-item',
        marker: ordered ? `${parseInt(raw, 10)}.` : '•',
        text: list[3].trim(),
        depth: Math.min(3, Math.floor(indent / 2)),
      });
      continue;
    }

    const quoted = RE_QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      quote.push(quoted[1].trim());
      continue;
    }
    flushQuote();

    if (RE_RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    if (RE_TABLE_ROW.test(line)) {
      flushParagraph();
      // Las tablas reales necesitarían un grid de <View>; degradamos a texto
      // legible en vez de imprimir los pipes crudos.
      if (RE_TABLE_SEP.test(line)) continue;
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length) blocks.push({ kind: 'paragraph', text: cells.join('  ·  ') });
      continue;
    }

    paragraph.push(line.trim());
  }

  if (code !== null && code.length) blocks.push({ kind: 'code', text: code.join('\n') });
  flushSoft();

  return blocks;
}

/**
 * Un solo regex alternado. El orden importa: código primero, para que un `**`
 * dentro de backticks quede literal.
 */
const RE_INLINE =
  /`([^`]+)`|(\*\*|__)(.+?)\2|(\*|_)(.+?)\4|==(.+?)==|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInlineSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const src = text ?? '';
  let last = 0;

  RE_INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_INLINE.exec(src)) !== null) {
    if (m.index > last) spans.push({ kind: 'text', text: src.slice(last, m.index) });

    if (m[1] !== undefined) spans.push({ kind: 'code', text: m[1] });
    else if (m[3] !== undefined) spans.push({ kind: 'bold', text: m[3] });
    else if (m[5] !== undefined) spans.push({ kind: 'italic', text: m[5] });
    else if (m[6] !== undefined) spans.push({ kind: 'mark', text: m[6] });
    else if (m[7] !== undefined) spans.push({ kind: 'link', text: m[7], href: m[8] });

    last = m.index + m[0].length;
  }

  if (last < src.length) spans.push({ kind: 'text', text: src.slice(last) });
  if (!spans.length) spans.push({ kind: 'text', text: src });

  return spans;
}
