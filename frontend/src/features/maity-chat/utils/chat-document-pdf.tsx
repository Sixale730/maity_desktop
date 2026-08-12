/**
 * PDF de los documentos que genera Maity Chat (tool `create_document`).
 *
 * Cargado vía dynamic import desde ChatTurn — mantiene @react-pdf/renderer fuera
 * del bundle inicial de Next.js (mismo patrón que MinutaToolbar).
 *
 * Sin `Font.register`: solo las fuentes built-in del formato PDF (Helvetica,
 * Helvetica-Bold, Courier). Así no hay fetch de red que la CSP tenga que
 * permitir ni assets que empaquetar.
 */
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { parseMarkdownBlocks, parseInlineSpans, type MdBlock } from './markdownBlocks';

// Sin esto react-pdf parte las palabras en español en lugares horribles.
Font.registerHyphenationCallback((w) => [w]);

const palette = {
  ink: '#111827',
  text: '#1f2937',
  muted: '#6b7280',
  hairline: '#e5e7eb',
  // Azul Maity — el mismo del borde de la card del documento en el chat, para
  // que este PDF y el de la minuta se lean como la misma familia.
  accent: '#485df4',
  mark: '#fde68a',
};

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    color: palette.text,
    lineHeight: 1.5,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    paddingBottom: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: palette.ink,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 9,
    color: palette.muted,
    marginTop: 4,
  },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: palette.ink, marginTop: 14, marginBottom: 4 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: palette.ink, marginTop: 12, marginBottom: 3 },
  h3: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: palette.ink, marginTop: 10, marginBottom: 3 },
  paragraph: { marginBottom: 6 },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 14, color: palette.accent },
  bulletText: { flex: 1 },
  quote: {
    fontStyle: 'italic',
    color: palette.muted,
    borderLeftWidth: 1.5,
    borderLeftColor: palette.hairline,
    paddingLeft: 8,
    marginVertical: 6,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 9,
    backgroundColor: '#f9fafb',
    padding: 6,
    marginVertical: 6,
    color: palette.ink,
  },
  rule: {
    borderTopWidth: 0.5,
    borderTopColor: palette.hairline,
    marginVertical: 10,
  },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontStyle: 'italic' },
  inlineCode: { fontFamily: 'Courier', fontSize: 9.5, color: palette.ink },
  mark: { backgroundColor: palette.mark, color: palette.ink },
  link: { color: palette.accent },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: palette.muted,
    textAlign: 'center',
    borderTopWidth: 0.5,
    borderTopColor: palette.hairline,
    paddingTop: 6,
  },
});

/** Renderiza el markdown inline (negritas, itálicas, código, `==resaltado==`). */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInlineSpans(text).map((s, i) => {
        switch (s.kind) {
          case 'bold':
            return <Text key={i} style={styles.bold}>{s.text}</Text>;
          case 'italic':
            return <Text key={i} style={styles.italic}>{s.text}</Text>;
          case 'code':
            return <Text key={i} style={styles.inlineCode}>{s.text}</Text>;
          case 'mark':
            return <Text key={i} style={styles.mark}>{s.text}</Text>;
          case 'link':
            return <Text key={i} style={styles.link}>{s.text}</Text>;
          default:
            return <Text key={i}>{s.text}</Text>;
        }
      })}
    </>
  );
}

function renderBlock(block: MdBlock, key: number) {
  switch (block.kind) {
    case 'heading': {
      const style = block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
      return (
        <Text key={key} style={style} wrap={false}>
          {block.text}
        </Text>
      );
    }
    case 'list-item':
      return (
        <View key={key} style={[styles.bullet, { paddingLeft: block.depth * 12 }]}>
          <Text style={styles.bulletDot}>{block.marker}</Text>
          <Text style={styles.bulletText}>
            <Inline text={block.text} />
          </Text>
        </View>
      );
    case 'quote':
      return (
        <Text key={key} style={styles.quote}>
          <Inline text={block.text} />
        </Text>
      );
    case 'code':
      return (
        <Text key={key} style={styles.code}>
          {block.text}
        </Text>
      );
    case 'rule':
      return <View key={key} style={styles.rule} />;
    default:
      return (
        <Text key={key} style={styles.paragraph}>
          <Inline text={block.text} />
        </Text>
      );
  }
}

export interface ChatDocumentPdfProps {
  title: string;
  content: string;
  userName?: string;
  generatedAt?: Date;
}

export function ChatDocumentPdf({ title, content, userName, generatedAt }: ChatDocumentPdfProps) {
  const blocks = parseMarkdownBlocks(content);
  const dateLabel = (generatedAt ?? new Date()).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Document title={title} author="Maity">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.metaRow}>
            {userName ? <Text>{userName} ·</Text> : null}
            <Text>{dateLabel}</Text>
          </View>
        </View>

        {blocks.map((b, i) => renderBlock(b, i))}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Generado por Maity — ${pageNumber}/${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
