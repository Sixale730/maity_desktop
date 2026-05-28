/**
 * Extracción de texto de documentos client-side para los adjuntos del chat.
 *
 * Usa librerías JS que corren en el navegador — sin round-trip al server, sin
 * endpoint nuevo. Cada parser se carga vía `import()` dinámico para que las
 * libs pesadas (pdfjs, mammoth, xlsx) solo se descarguen cuando el usuario
 * realmente adjunta un archivo de ese tipo.
 *
 * Soportado: pdf, docx, xlsx/xls, txt, csv, md. (PDFs escaneados/imagen no
 * tienen capa de texto → 'empty'. OCR fuera de alcance.)
 *
 * Port del web (Sixale730/maity) con UN solo cambio: el worker de pdfjs. El
 * web usa la sintaxis Vite `import('pdfjs-dist/build/pdf.worker.min.mjs?url')`
 * que NO existe en Next; el desktop sirve el worker same-origin desde
 * `public/pdf.worker.min.mjs` (satisface el CSP `default-src 'self'`).
 */

/** Máximo de caracteres por documento — acota el costo en tokens al inyectarlo
 *  como contexto del chat. Archivos más grandes se truncan con un marcador. */
export const MAX_DOC_CHARS = 16_000;

export interface ExtractedDocument {
  filename: string;
  text: string;
  truncated: boolean;
}

export type ExtractErrorCode = 'unsupported' | 'empty' | 'failed';

export class DocumentExtractError extends Error {
  constructor(public readonly code: ExtractErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DocumentExtractError';
  }
}

const TEXT_EXTS = new Set(['txt', 'csv', 'md', 'markdown', 'log', 'json']);

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';

  let text: string;
  try {
    if (ext === 'pdf') text = await extractPdf(file);
    else if (ext === 'docx') text = await extractDocx(file);
    else if (ext === 'xlsx' || ext === 'xls') text = await extractXlsx(file);
    else if (TEXT_EXTS.has(ext)) text = await file.text();
    else throw new DocumentExtractError('unsupported', `Unsupported extension: ${ext}`);
  } catch (err) {
    if (err instanceof DocumentExtractError) throw err;
    throw new DocumentExtractError('failed', err instanceof Error ? err.message : String(err));
  }

  text = text.trim();
  if (!text) throw new DocumentExtractError('empty');

  const truncated = text.length > MAX_DOC_CHARS;
  if (truncated) text = `${text.slice(0, MAX_DOC_CHARS)}\n\n[…contenido truncado]`;

  return { filename: file.name, text, truncated };
}

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  // Adapter Next.js: el worker se sirve same-origin desde public/. Debe
  // coincidir en versión con pdfjs-dist (copiado desde node_modules/.../build).
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const parts: string[] = [];
  const maxPages = Math.min(pdf.numPages, 50);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) parts.push(line);
  }
  return parts.join('\n\n');
}

async function extractDocx(file: File): Promise<string> {
  const { extractRawText } = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await extractRawText({ arrayBuffer });
  return value;
}

async function extractXlsx(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 10)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`# ${name}\n${csv}`);
  }
  return parts.join('\n\n');
}
