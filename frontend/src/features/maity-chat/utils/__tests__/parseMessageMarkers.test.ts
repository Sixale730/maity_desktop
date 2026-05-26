/**
 * Unit tests for parseMessageMarkers.
 *
 * Covers: presence/absence of each marker, both markers in same message,
 * malformed markers, whitespace tolerance, length caps (defense against
 * runaway LLM output), and that the body is always clean of markers.
 */

import { describe, it, expect } from 'vitest';
import { parseMessageMarkers } from '../parseMessageMarkers';

describe('parseMessageMarkers', () => {
  it('returns the content untouched when no markers are present', () => {
    const out = parseMessageMarkers('Esto es una respuesta normal de Maity.');
    expect(out.docTitle).toBeUndefined();
    expect(out.ctaLabel).toBeUndefined();
    expect(out.body).toBe('Esto es una respuesta normal de Maity.');
  });

  it('handles empty input gracefully', () => {
    expect(parseMessageMarkers('').body).toBe('');
  });

  it('extracts a DOC marker from the start and strips it', () => {
    const out = parseMessageMarkers('[[DOC: Plan para tu 1:1]]\n# Paso 1\n\nHaz X.');
    expect(out.docTitle).toBe('Plan para tu 1:1');
    expect(out.body).toBe('# Paso 1\n\nHaz X.');
    expect(out.ctaLabel).toBeUndefined();
  });

  it('tolerates whitespace around the DOC marker', () => {
    const out = parseMessageMarkers('  [[DOC:   Cotización XYZ   ]]  \n\nContenido aquí.');
    expect(out.docTitle).toBe('Cotización XYZ');
    expect(out.body).toBe('Contenido aquí.');
  });

  it('extracts a CTA marker from the end and strips it', () => {
    const out = parseMessageMarkers('¿Quieres que arme un plan?\n\n[[CTA: Generar plan para tu 1:1]]');
    expect(out.ctaLabel).toBe('Generar plan para tu 1:1');
    expect(out.body).toBe('¿Quieres que arme un plan?');
    expect(out.docTitle).toBeUndefined();
  });

  it('extracts both markers when present', () => {
    const input = '[[DOC: Cotización Cliente A]]\n## Concepto\nDetalle.\n\n[[CTA: Ajustar la cotización]]';
    const out = parseMessageMarkers(input);
    expect(out.docTitle).toBe('Cotización Cliente A');
    expect(out.ctaLabel).toBe('Ajustar la cotización');
    expect(out.body).toBe('## Concepto\nDetalle.');
  });

  it('ignores a DOC marker that is not at the very start', () => {
    const out = parseMessageMarkers('Hola.\n[[DOC: x]]\nNo es válido.');
    expect(out.docTitle).toBeUndefined();
    // Body kept as-is (marker stays visible — better than silently swallowing).
    expect(out.body).toMatch(/\[\[DOC: x\]\]/);
  });

  it('ignores a CTA marker that is not at the very end', () => {
    const out = parseMessageMarkers('[[CTA: x]]\nHay texto después.');
    expect(out.ctaLabel).toBeUndefined();
    expect(out.body).toMatch(/\[\[CTA: x\]\]/);
  });

  it('rejects an empty DOC title and leaves the marker in place', () => {
    const out = parseMessageMarkers('[[DOC: ]]\nContenido.');
    expect(out.docTitle).toBeUndefined();
    expect(out.body).toMatch(/\[\[DOC: \]\]/);
  });

  it('rejects an oversized DOC title (>120 chars) and leaves it in place', () => {
    const long = 'x'.repeat(121);
    const out = parseMessageMarkers(`[[DOC: ${long}]]\nContenido.`);
    expect(out.docTitle).toBeUndefined();
  });

  it('rejects an oversized CTA label (>80 chars) and leaves it in place', () => {
    const long = 'x'.repeat(81);
    const out = parseMessageMarkers(`Texto.\n[[CTA: ${long}]]`);
    expect(out.ctaLabel).toBeUndefined();
  });

  it('does not match a malformed marker (missing closing brackets)', () => {
    const out = parseMessageMarkers('[[DOC: incompleto\nContenido.');
    expect(out.docTitle).toBeUndefined();
    expect(out.body).toContain('[[DOC: incompleto');
  });

  it('preserves internal markdown content untouched', () => {
    const input = '[[DOC: Plan]]\n# Título\n\n- bullet 1\n- bullet 2\n\n**bold** text.';
    const out = parseMessageMarkers(input);
    expect(out.body).toBe('# Título\n\n- bullet 1\n- bullet 2\n\n**bold** text.');
  });
});
