// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/conversation-moments.test.ts
// Adaptaciones desktop: @/features/omi/* resuelve a los adapters del desktop por alias (features/dashboard/adapters, dashboard-v1/adapter).
import { describe, expect, it } from 'vitest';
import type { OmiConversationListItem, OmiTranscriptSegment } from '@/features/omi/services/omi.service';
import { buildConversationMoments, latestAnalyzedConversation, verifiedEvidence } from './conversation-moments';

const quote = 'Te enviaré el resumen mañana';
const conversation = (raw: Record<string, unknown> | null, overrides = {}): OmiConversationListItem => ({ id: 'one', user_id: 'u', created_at: '2026-09-16', title: 'Sesión', overview: '', emoji: null, category: null, source: null, words_count: 30, duration_seconds: 60, communication_feedback: null, communication_feedback_v4: raw, ...overrides });
const segment = (overrides = {}): OmiTranscriptSegment => ({ id: 's', conversation_id: 'one', segment_index: 1, text: quote, speaker: 'Usuario', speaker_id: 1, is_user: true, start_time: 24, end_time: 30, ...overrides });
const feedback = { calidad_global: { fortaleza: 'Claridad', fortaleza_hint: 'Idea concreta', mejorar: 'Propósito', mejorar_hint: 'Confirma la acción' }, dimensiones: { claridad: { puntaje: 80, hallazgos: [{ cita: quote }] }, proposito: { puntaje: 50, hallazgos: [{ cita: quote, alternativa: '¿Quién confirma el siguiente paso?' }] } } };

describe('moments evidence', () => {
  it('returns only the latest analyzed conversation without mutating input', () => {
    const old = conversation(feedback, { created_at: '2026-09-10' });
    const latest = conversation(feedback, { id: 'two' });
    const pending = conversation(null, { created_at: '2026-09-17' });
    const list = [old, pending, latest];
    expect(latestAnalyzedConversation(list)).toBe(latest);
    expect(list[0]).toBe(old);
  });
  it('does not use another speaker, unknown speaker, or another conversation as evidence', () => {
    for (const change of [{ is_user: false }, { is_user: null }, { conversation_id: 'two' }, { text: 'Texto distinto' }]) {
      expect(verifiedEvidence(quote, [segment(change)], 'one')).toBeUndefined();
    }
  });
  it('preserves a confirmed quote and omits invalid timestamps', () => {
    expect(verifiedEvidence(quote, [segment()], 'one')?.seconds).toBe(24);
    expect(verifiedEvidence(quote, [segment({ start_time: NaN })], 'one')).toEqual({ quote, context: quote });
  });
  it('excludes low confidence feedback even if legacy feedback exists', () => {
    expect(buildConversationMoments(conversation({ ...feedback, calidad_insumo: { nivel: 'baja' } }, { communication_feedback: { strengths: ['Viejo'] } }), [segment()])).toEqual({ unavailable: true });
  });
  it('does not treat a non-applicable dimension as weakness', () => {
    const raw = { ...feedback, calidad_global: { mejorar: 'Empatía', mejorar_hint: 'No medida' }, recording_mode: 'presentation' };
    expect(buildConversationMoments(conversation(raw), []).improvement).toBeUndefined();
  });
  it('connects the right dimension to a verified phrase and its proposed alternative', () => {
    const result = buildConversationMoments(conversation(feedback), [segment()]);
    expect(result.strength?.title).toBe('Claridad');
    expect(result.improvement?.evidence?.quote).toBe(quote);
    expect(result.improvement?.suggestion).toBe('¿Quién confirma el siguiente paso?');
  });
  it('keeps an analysis hint but never displays an unverified quotation', () => {
    const result = buildConversationMoments(conversation(feedback), []);
    expect(result.strength?.explanation).toBe('Idea concreta');
    expect(result.strength?.evidence).toBeUndefined();
  });
  it('does not turn legacy summaries into literal quotes', () => {
    const result = buildConversationMoments(conversation(null, { communication_feedback: { strengths: ['Buena claridad'], areas_to_improve: ['Confirma el cierre'] } }), [segment()]);
    expect(result.strength?.explanation).toBe('Buena claridad');
    expect(result.strength).not.toHaveProperty('evidence');
  });
});
