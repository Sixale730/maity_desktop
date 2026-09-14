/**
 * fetchCompanySttTerms: la RPC debe ir por el wrapper `public.get_stt_terms`
 * (regla del repo: RPCs SIEMPRE por wrappers public.*) y los errores deben
 * devolver `null` (el caller no pisa el cache local de Rust en ese caso).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

// Mismo patrón que conversations.service.test.ts: la factory solo LEE
// `mock` en runtime (getter), nunca al registrar el mock.
const mock = createMockSupabaseClient('public');

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mock.client;
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchCompanySttTerms } from './sttTerms.service';

describe('fetchCompanySttTerms', () => {
  beforeEach(() => {
    mock.reset();
  });

  it("pide get_stt_terms contra el schema 'public'", async () => {
    mock.setRpc('get_stt_terms', () => ({ data: [], error: null }));
    await fetchCompanySttTerms();
    expect(mock.schemaOf('get_stt_terms')).toBe('public');
  });

  it('devuelve los pares válidos y filtra basura', async () => {
    mock.setRpc('get_stt_terms', () => ({
      data: [
        { wrong: 'alien', right: 'Allianz' },
        { wrong: 42, right: 'x' },
        'no-es-objeto',
      ] as unknown as null,
      error: null,
    }));
    const terms = await fetchCompanySttTerms();
    expect(terms).toEqual([{ wrong: 'alien', right: 'Allianz' }]);
  });

  it('devuelve [] si la RPC responde algo que no es array', async () => {
    mock.setRpc('get_stt_terms', () => ({ data: {} as unknown as null, error: null }));
    expect(await fetchCompanySttTerms()).toEqual([]);
  });

  it('devuelve null en error de la RPC (no pisar el cache local)', async () => {
    mock.setRpc('get_stt_terms', () => ({ data: null, error: new Error('offline') }));
    expect(await fetchCompanySttTerms()).toBeNull();
  });

  it('devuelve null si la RPC no existe (excepción)', async () => {
    // Sin handler registrado el mock devuelve error → null.
    expect(await fetchCompanySttTerms()).toBeNull();
  });
});
