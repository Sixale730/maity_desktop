import { describe, it, expect } from 'vitest';
import type { OmiConversation } from '../services/conversations.service';
import { getCommScore, isLowConfidenceV4 } from './scoring';

function conv(overrides: Partial<OmiConversation> = {}): OmiConversation {
  return {
    id: 'c-1',
    user_id: 'u-1',
    firebase_uid: null,
    created_at: '2026-08-21T10:00:00Z',
    started_at: null,
    finished_at: null,
    title: '',
    overview: '',
    emoji: null,
    category: null,
    action_items: null,
    events: null,
    transcript_text: null,
    source: 'maity_desktop',
    language: null,
    status: null,
    words_count: null,
    duration_seconds: null,
    communication_feedback: null,
    communication_feedback_v4: null,
    meeting_minutes_data: null,
    analysis_status: null,
    ...overrides,
  };
}

const v4 = (extra: Record<string, unknown> = {}) =>
  ({ calidad_global: { puntaje: 72, componentes: {} }, ...extra }) as never;

describe('isLowConfidenceV4', () => {
  it('true solo con calidad_insumo.nivel === "baja"', () => {
    expect(isLowConfidenceV4({ calidad_insumo: { nivel: 'baja' } })).toBe(true);
    expect(isLowConfidenceV4({ calidad_insumo: { nivel: 'alta' } })).toBe(false);
    expect(isLowConfidenceV4({ calidad_global: { puntaje: 1 } })).toBe(false);
    expect(isLowConfidenceV4(null)).toBe(false);
    expect(isLowConfidenceV4('baja')).toBe(false);
  });
});

describe('getCommScore', () => {
  it('lee calidad_global.puntaje de un V4 6.1 con nivel alta', () => {
    const c = conv({ communication_feedback_v4: v4({ calidad_insumo: { nivel: 'alta', duracion_total_min: 60, tramos_densos_min: 30 } }) });
    expect(getCommScore(c)).toBe(72);
  });

  it('cuenta normal las filas anteriores a #147 (sin calidad_insumo)', () => {
    expect(getCommScore(conv({ communication_feedback_v4: v4() }))).toBe(72);
  });

  it('devuelve null con calidad_insumo.nivel === "baja" (#73): no entra a historial ni sparkline', () => {
    const c = conv({ communication_feedback_v4: v4({ calidad_insumo: { nivel: 'baja', duracion_total_min: 60, tramos_densos_min: 30 } }) });
    expect(getCommScore(c)).toBeNull();
  });

  it('devuelve null para el marcador skipped, con cualquier reason', () => {
    expect(getCommScore(conv({ communication_feedback_v4: { status: 'skipped', reason: 'insufficient_user_words' } as never }))).toBeNull();
    expect(getCommScore(conv({ communication_feedback_v4: { status: 'skipped', reason: 'no_evaluable_speech' } as never }))).toBeNull();
  });

  it('cae a resumen.puntuacion_global y a legacy overall_score ×10', () => {
    expect(getCommScore(conv({ communication_feedback_v4: { resumen: { puntuacion_global: 55 } } as never }))).toBe(55);
    expect(getCommScore(conv({ communication_feedback: { overall_score: 6.5 } as never }))).toBe(65);
    expect(getCommScore(conv())).toBeNull();
  });

  it('issue #05 fase 2: con _projection==="list" usa _listCommScore aunque los JSONB estén en null', () => {
    const c = conv({ _projection: 'list', _listCommScore: 80 });
    expect(c.communication_feedback_v4).toBeNull();
    expect(getCommScore(c)).toBe(80);
  });

  it('issue #05 fase 2: _projection==="list" con _listCommScore null (skipped/baja confianza) devuelve null, no recalcula del JSONB', () => {
    // El v4 completo de abajo daría 72 si se leyera — confirma que el atajo
    // de proyección corta ANTES de llegar a esa rama.
    const c = conv({ _projection: 'list', _listCommScore: null, communication_feedback_v4: v4() });
    expect(getCommScore(c)).toBeNull();
  });
});
