import { describe, it, expect } from 'vitest';
import type { OmiConversation } from '../services/conversations.service';
import { derivePhase, isTerminalPhase, STALL_TIMEOUT_MS } from './derivePhase';

const NOW = Date.parse('2026-05-04T12:00:00Z');
const RECENT = new Date(NOW - 30_000).toISOString();
const STALE = new Date(NOW - STALL_TIMEOUT_MS - 1_000).toISOString();

function base(overrides: Partial<OmiConversation> = {}): OmiConversation {
  return {
    id: 'c-1',
    user_id: 'u-1',
    firebase_uid: null,
    created_at: RECENT,
    started_at: RECENT,
    finished_at: RECENT,
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

describe('derivePhase', () => {
  it('returns "completed" when both v4 and minuta are present (trusts data over status)', () => {
    const conv = base({
      communication_feedback_v4: { calidad_global: { puntaje: 80 } } as never,
      meeting_minutes_data: { meta: {} } as never,
      analysis_status: 'failed', // mentiroso: data presente pero status dice failed
    });
    expect(derivePhase(conv, NOW)).toBe('completed');
  });

  it('returns "skipped" when v4 carries the skip marker', () => {
    const conv = base({
      communication_feedback_v4: { status: 'skipped', reason: 'insufficient_user_words' } as never,
      analysis_status: 'skipped',
    });
    expect(derivePhase(conv, NOW)).toBe('skipped');
  });

  it('returns "skipped" for the no_evaluable_speech marker (#147) even with metrics attached', () => {
    const conv = base({
      communication_feedback_v4: {
        status: 'skipped',
        reason: 'no_evaluable_speech',
        user_words: 180,
        min_required: 100,
        speakers: 1,
        metrics: { duracion_total_min: 59.7, tramos_densos_min: 0, palabras_descartadas: 63 },
      } as never,
      analysis_status: 'skipped',
    });
    expect(derivePhase(conv, NOW)).toBe('skipped');
  });

  it('returns "quota_skipped" from the status flag when the v4 is still null', () => {
    const conv = base({ analysis_status: 'quota_skipped' });
    expect(derivePhase(conv, NOW)).toBe('quota_skipped');
  });

  it('returns "completed" from status flag when data is somehow missing', () => {
    const conv = base({ analysis_status: 'completed' });
    expect(derivePhase(conv, NOW)).toBe('completed');
  });

  it('returns "failed" when status is failed and no data present', () => {
    const conv = base({ analysis_status: 'failed' });
    expect(derivePhase(conv, NOW)).toBe('failed');
  });

  it('returns "polling" when status is processing and finished recently', () => {
    const conv = base({ analysis_status: 'processing' });
    expect(derivePhase(conv, NOW)).toBe('polling');
  });

  it('returns "polling" when status is null but conversation just finished (covers backend null bug)', () => {
    const conv = base({ analysis_status: null, finished_at: RECENT });
    expect(derivePhase(conv, NOW)).toBe('polling');
  });

  it('returns "polling" when status is pending and recent', () => {
    const conv = base({ analysis_status: 'pending' });
    expect(derivePhase(conv, NOW)).toBe('polling');
  });

  it('returns "stalled" when status is non-terminal but finished_at is older than STALL_TIMEOUT_MS', () => {
    const conv = base({ analysis_status: 'processing', finished_at: STALE });
    expect(derivePhase(conv, NOW)).toBe('stalled');
  });

  it('returns "stalled" when status is null and conversation finished long ago', () => {
    const conv = base({ analysis_status: null, finished_at: STALE });
    expect(derivePhase(conv, NOW)).toBe('stalled');
  });

  it('returns "idle" when there is no finished_at, started_at, or created_at to compute age', () => {
    const conv = base({
      analysis_status: null,
      finished_at: null,
      started_at: null,
      // @ts-expect-error created_at is required by type but null exercises the guard
      created_at: null,
    });
    expect(derivePhase(conv, NOW)).toBe('idle');
  });

  it('falls back to started_at when finished_at is null', () => {
    const conv = base({ analysis_status: 'processing', finished_at: null, started_at: STALE });
    expect(derivePhase(conv, NOW)).toBe('stalled');
  });
});

describe('derivePhase — proyección ligera (issue #05 fase 2, _projection==="list")', () => {
  it('fila ligera "full" + minuta → "completed" sin tocar los JSONB (que están en null)', () => {
    const conv = base({
      _projection: 'list',
      _listAnalysis: 'full',
      _listHasMinuta: true,
      // JSONB reales ausentes a propósito — si el branch de proyección no
      // cortara antes, isFullAnalysis(null) sería falso y esto NO daría 'completed'.
      communication_feedback_v4: null,
      meeting_minutes_data: null,
      analysis_status: 'completed',
    });
    expect(derivePhase(conv, NOW)).toBe('completed');
  });

  it('fila ligera "none" con analysis_status null de hace 30 min → "stalled" (apaga el poll)', () => {
    const thirtyMinAgo = new Date(NOW - 30 * 60 * 1000).toISOString();
    const conv = base({
      _projection: 'list',
      _listAnalysis: 'none',
      _listHasMinuta: false,
      analysis_status: null,
      finished_at: thirtyMinAgo,
      started_at: thirtyMinAgo,
    });
    expect(derivePhase(conv, NOW)).toBe('stalled');
  });

  it('la misma fila ligera "none" pero de hace 1 min → "polling" (no rompe la conversación recién creada)', () => {
    const oneMinAgo = new Date(NOW - 60 * 1000).toISOString();
    const conv = base({
      _projection: 'list',
      _listAnalysis: 'none',
      _listHasMinuta: false,
      analysis_status: null,
      finished_at: oneMinAgo,
      started_at: oneMinAgo,
    });
    expect(derivePhase(conv, NOW)).toBe('polling');
  });

  it('fila ligera con _listAnalysis="skipped" → "skipped" sin mirar communication_feedback_v4', () => {
    const conv = base({
      _projection: 'list',
      _listAnalysis: 'skipped',
      _listHasMinuta: false,
      communication_feedback_v4: null,
      analysis_status: 'skipped',
    });
    expect(derivePhase(conv, NOW)).toBe('skipped');
  });
});

describe('isTerminalPhase', () => {
  it.each(['completed', 'failed', 'skipped', 'quota_skipped'] as const)('returns true for %s', (phase) => {
    expect(isTerminalPhase(phase)).toBe(true);
  });

  it.each(['idle', 'polling', 'stalled'] as const)('returns false for %s', (phase) => {
    expect(isTerminalPhase(phase)).toBe(false);
  });
});
