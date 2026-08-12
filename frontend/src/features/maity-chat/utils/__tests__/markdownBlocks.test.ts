import { describe, it, expect } from 'vitest';
import { parseMarkdownBlocks, parseInlineSpans } from '../markdownBlocks';

describe('parseMarkdownBlocks', () => {
  it('parsea encabezados y limita el nivel a 3', () => {
    const blocks = parseMarkdownBlocks('# Uno\n## Dos\n#### Cuatro');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Uno' },
      { kind: 'heading', level: 2, text: 'Dos' },
      { kind: 'heading', level: 3, text: 'Cuatro' },
    ]);
  });

  it('une líneas consecutivas en un párrafo y separa por línea en blanco', () => {
    const blocks = parseMarkdownBlocks('linea uno\nlinea dos\n\notro parrafo');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'linea uno linea dos' },
      { kind: 'paragraph', text: 'otro parrafo' },
    ]);
  });

  it('parsea listas con viñeta, numeradas y anidadas', () => {
    const blocks = parseMarkdownBlocks('- uno\n* dos\n  - anidado\n1. primero\n2) segundo');
    expect(blocks).toEqual([
      { kind: 'list-item', marker: '•', text: 'uno', depth: 0 },
      { kind: 'list-item', marker: '•', text: 'dos', depth: 0 },
      { kind: 'list-item', marker: '•', text: 'anidado', depth: 1 },
      { kind: 'list-item', marker: '1.', text: 'primero', depth: 0 },
      { kind: 'list-item', marker: '2.', text: 'segundo', depth: 0 },
    ]);
  });

  it('junta líneas de cita y detecta reglas', () => {
    const blocks = parseMarkdownBlocks('> algo\n> mas\n\n---');
    expect(blocks).toEqual([
      { kind: 'quote', text: 'algo mas' },
      { kind: 'rule' },
    ]);
  });

  it('acumula el bloque de código verbatim sin parsear su contenido', () => {
    const blocks = parseMarkdownBlocks('```js\n# no es heading\n- ni lista\n```');
    expect(blocks).toEqual([{ kind: 'code', text: '# no es heading\n- ni lista' }]);
  });

  it('cierra un fence sin terminar en vez de perder el contenido', () => {
    const blocks = parseMarkdownBlocks('```\nsin cerrar');
    expect(blocks).toEqual([{ kind: 'code', text: 'sin cerrar' }]);
  });

  it('degrada tablas GFM a texto y descarta la fila separadora', () => {
    const blocks = parseMarkdownBlocks('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'A  ·  B' },
      { kind: 'paragraph', text: '1  ·  2' },
    ]);
  });

  it('tolera entrada vacía y CRLF', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks('a\r\n\r\nb')).toEqual([
      { kind: 'paragraph', text: 'a' },
      { kind: 'paragraph', text: 'b' },
    ]);
  });
});

describe('parseInlineSpans', () => {
  it('reconoce negrita, itálica, código, resaltado y links', () => {
    expect(parseInlineSpans('a **b** c *d* `e` ==f== [g](http://h)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'e' },
      { kind: 'text', text: ' ' },
      { kind: 'mark', text: 'f' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'g', href: 'http://h' },
    ]);
  });

  it('deja literal el markdown dentro de backticks', () => {
    expect(parseInlineSpans('`**no negrita**`')).toEqual([
      { kind: 'code', text: '**no negrita**' },
    ]);
  });

  it('devuelve un solo span de texto cuando no hay marcas', () => {
    expect(parseInlineSpans('texto plano')).toEqual([{ kind: 'text', text: 'texto plano' }]);
  });

  it('es reentrante (el regex global no arrastra lastIndex)', () => {
    const input = '**x** y';
    expect(parseInlineSpans(input)).toEqual(parseInlineSpans(input));
  });
});
