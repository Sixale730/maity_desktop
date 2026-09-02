/**
 * Issue #05 fase 2 (D1): `getOmiConversations` pasó de `select('*')` sin
 * límite a una proyección ligera con tope. Este archivo es el que impide que
 * alguien vuelva a `select('*')` — cubre las columnas exactas del select, el
 * límite por defecto/override, y la tabla de casos del mapper `toListRow`
 * (no exportado directamente; se ejerce a través de `getOmiConversations`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

// Declarado ANTES del vi.mock/import del módulo bajo prueba: mismo patrón que
// GlobalConversationNotifier.test.tsx — la factory de abajo solo LEE
// `mockSupabase` en tiempo de ejecución (dentro de getOmiConversations),
// nunca al registrar el mock, así que el orden temporal no importa.
const mockSupabase = createMockSupabaseClient('public');

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabase.client;
  },
}));

import { getOmiConversations, LIST_DEFAULT_LIMIT } from './conversations.service';

const USER_ID = 'user-1';
const TABLE = 'omi_conversations';

/** Fila cruda tal como la devolvería PostgREST para `LIST_COLUMNS` — las
 *  claves son los ALIAS (`v4_status`, `minuta_titulo`, ...), no las columnas
 *  originales. */
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    user_id: USER_ID,
    firebase_uid: null,
    created_at: '2026-08-01T10:00:00Z',
    started_at: '2026-08-01T10:00:00Z',
    finished_at: '2026-08-01T10:05:00Z',
    updated_at: '2026-08-01T10:05:00Z',
    title: 'Conversación de prueba',
    overview: 'Overview',
    emoji: null,
    category: null,
    source: 'maity_desktop',
    language: 'es',
    status: null,
    words_count: 120,
    duration_seconds: 300,
    analysis_status: null,
    analysis_error_message: null,
    idempotency_key: 'idem-1',
    action_items: [{ description: 'hacer algo' }],
    v4_status: null,
    v4_reason: null,
    v4_insumo_nivel: null,
    v4_calidad_global: null,
    v4_resumen_puntuacion: null,
    v1_overall_score: null,
    minuta_titulo: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSupabase.reset();
});

describe('getOmiConversations — select (D1)', () => {
  it('no usa select("*") ni baja transcript_text o los JSONB como columnas planas', async () => {
    mockSupabase.setTableResult(TABLE, { data: [], error: null });
    await getOmiConversations(USER_ID);

    const columns = mockSupabase.selectOf(TABLE);
    expect(typeof columns).toBe('string');
    const cols = columns as string;
    expect(cols).not.toContain('*');
    expect(cols.split(',')).not.toContain('transcript_text');
    expect(cols.split(',')).not.toContain('communication_feedback');
    expect(cols.split(',')).not.toContain('communication_feedback_v4');
    expect(cols.split(',')).not.toContain('meeting_minutes_data');
    expect(cols.split(',')).not.toContain('events');
  });

  it('incluye action_items completo y los 7 alias JSONB', async () => {
    mockSupabase.setTableResult(TABLE, { data: [], error: null });
    await getOmiConversations(USER_ID);

    const cols = (mockSupabase.selectOf(TABLE) as string).split(',');
    expect(cols).toContain('action_items');
    expect(cols).toContain('v4_status:communication_feedback_v4->>status');
    expect(cols).toContain('v4_reason:communication_feedback_v4->>reason');
    expect(cols).toContain('v4_insumo_nivel:communication_feedback_v4->calidad_insumo->>nivel');
    expect(cols).toContain('v4_calidad_global:communication_feedback_v4->calidad_global');
    expect(cols).toContain('v4_resumen_puntuacion:communication_feedback_v4->resumen->puntuacion_global');
    expect(cols).toContain('v1_overall_score:communication_feedback->overall_score');
    expect(cols).toContain('minuta_titulo:meeting_minutes_data->meta->>titulo');
  });

  it('usa el schema maity', async () => {
    mockSupabase.setTableResult(TABLE, { data: [], error: null });
    await getOmiConversations(USER_ID);
    expect(mockSupabase.schemaOf(TABLE)).toBe('maity');
  });
});

describe('getOmiConversations — limit (D1)', () => {
  it('usa LIST_DEFAULT_LIMIT (200) cuando no se pasa opts.limit', async () => {
    mockSupabase.setTableResult(TABLE, { data: [], error: null });
    await getOmiConversations(USER_ID);
    expect(mockSupabase.limitOf(TABLE)).toBe(LIST_DEFAULT_LIMIT);
    expect(LIST_DEFAULT_LIMIT).toBe(200);
  });

  it('respeta un override de opts.limit', async () => {
    mockSupabase.setTableResult(TABLE, { data: [], error: null });
    await getOmiConversations(USER_ID, { limit: 400 });
    expect(mockSupabase.limitOf(TABLE)).toBe(400);
  });
});

describe('getOmiConversations — mapper toListRow (D1)', () => {
  it('marca _projection="list" y deja los 5 campos pesados en null', async () => {
    mockSupabase.setTableResult(TABLE, { data: [rawRow()], error: null });
    const [row] = await getOmiConversations(USER_ID);

    expect(row._projection).toBe('list');
    expect(row.transcript_text).toBeNull();
    expect(row.communication_feedback).toBeNull();
    expect(row.communication_feedback_v4).toBeNull();
    expect(row.meeting_minutes_data).toBeNull();
    expect(row.events).toBeNull();
    // action_items SÍ viaja completo — no es uno de los 5 pesados.
    expect(row.action_items).toEqual([{ description: 'hacer algo' }]);
  });

  it('skipped: v4_status="skipped" → _listAnalysis="skipped" y _listCommScore null', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v4_status: 'skipped', v4_calidad_global: { puntaje: 90 } })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listAnalysis).toBe('skipped');
    expect(row._listCommScore).toBeNull();
  });

  it('calidad_global como objeto {puntaje} → full + score del puntaje', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v4_calidad_global: { puntaje: 72, componentes: {} } })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listAnalysis).toBe('full');
    expect(row._listCommScore).toBe(72);
  });

  it('calidad_global como número suelto → full + score del número', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v4_calidad_global: 65 })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listAnalysis).toBe('full');
    expect(row._listCommScore).toBe(65);
  });

  it('solo v4_resumen_puntuacion (sin calidad_global) → full + score del resumen', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v4_resumen_puntuacion: 58 })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listAnalysis).toBe('full');
    expect(row._listCommScore).toBe(58);
  });

  it('nivel:"baja" con puntaje presente → score null pero _listAnalysis sigue "full"', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v4_insumo_nivel: 'baja', v4_calidad_global: { puntaje: 80 } })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listAnalysis).toBe('full');
    expect(row._listCommScore).toBeNull();
  });

  it('solo v1_overall_score → score ×10, sin v4 ni analysis_status completado', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ v1_overall_score: 7.5, analysis_status: null })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listCommScore).toBe(75);
  });

  it('minuta_titulo presente → _listHasMinuta true', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ minuta_titulo: 'Reunión de seguimiento' })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listHasMinuta).toBe(true);
  });

  it('minuta_titulo ausente → _listHasMinuta false', async () => {
    mockSupabase.setTableResult(TABLE, {
      data: [rawRow({ minuta_titulo: null })],
      error: null,
    });
    const [row] = await getOmiConversations(USER_ID);
    expect(row._listHasMinuta).toBe(false);
  });
});
