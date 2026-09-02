/**
 * Regresión del issue #05 fase 1 (C2).
 *
 * `handleRealtimeUpdate` invalidaba la lista (`['omi-conversations', userId]`)
 * en CADA UPDATE de Realtime, incluidos los heartbeats de `updated_at` que el
 * backend escribe cada 30s mientras `analysis_status='processing'` — con el
 * Sidebar montado en toda la app (gcTime nunca corre), cada uno de esos
 * heartbeats se convertía en un fetch de `select('*')` real. Estos tests
 * protegen el reemplazo: parchear la caché en vez de invalidarla a ciegas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import { createMockSupabaseClient } from '@/test/mocks/supabase';
import type { OmiConversation } from '@/features/conversations/services/conversations.service';

const USER_ID = 'user-1';
const TOPIC = `global-conv-notifier-${USER_ID}`;
const LIST_KEY = ['omi-conversations', USER_ID] as const;

const routerPushMock = vi.fn();
const sendNativeNotificationMock = vi.fn();
const toastSuccessMock = vi.fn();
const realtimeSetAuthMock = vi.fn();

// Declarado ANTES de los vi.mock() y del import del componente: las
// factories de abajo solo LEEN `mockSupabase` cuando `supabase.X` se accede
// en tiempo de ejecución (dentro del efecto del componente, ya con el
// archivo de test completamente cargado) — nunca al registrar el mock. Mismo
// patrón que `useConversationLive.test.tsx` (mock declarado antes del import
// del hook bajo prueba).
const mockSupabase = createMockSupabaseClient();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
  usePathname: () => '/conversations',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ maityUser: { id: USER_ID } }),
}));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return { ...mockSupabase.client, realtime: { setAuth: realtimeSetAuthMock } };
  },
}));

vi.mock('@/lib/nativeNotification', () => ({
  // Envuelto en una función (no una referencia directa al vi.fn()): vi.mock
  // se hoistea por encima de las const de este archivo, así que embeber el
  // VALOR de sendNativeNotificationMock aquí arriba dispara "Cannot access
  // before initialization". Una closure difiere la lectura hasta que
  // realmente se llama, ya con el archivo completamente cargado.
  sendNativeNotification: (...args: unknown[]) => sendNativeNotificationMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

import { GlobalConversationNotifier } from './GlobalConversationNotifier';

function makeConversation(overrides: Partial<OmiConversation> = {}): OmiConversation {
  const now = new Date().toISOString();
  return {
    id: 'conv-1',
    user_id: USER_ID,
    firebase_uid: null,
    created_at: now,
    started_at: now,
    finished_at: now,
    title: 'Conversación de prueba',
    overview: 'overview',
    emoji: null,
    category: null,
    action_items: null,
    events: null,
    transcript_text: null,
    source: 'maity_desktop',
    language: null,
    status: null,
    words_count: 100,
    duration_seconds: 300,
    communication_feedback: null,
    communication_feedback_v4: null,
    meeting_minutes_data: null,
    analysis_status: 'processing',
    updated_at: now,
    ...overrides,
  };
}

function makeQueryClient(): QueryClient {
  // gcTime/staleTime Infinity: estas filas se siembran directo con
  // setQueryData, sin ningún useQuery montado que las observe — con el
  // gcTime por defecto de test (0) el garbage collector podría barrerlas
  // entre el seed y la aserción.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function renderNotifier(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'TestQueryClientProviderWrapper';
  return render(createElement(GlobalConversationNotifier), { wrapper: Wrapper });
}

/**
 * Monta el componente y confirma la suscripción (`emitStatus('SUBSCRIBED')`)
 * para que el connectTimer de 5s no dispare un reconnect a mitad de la
 * prueba — un reconnect reemplaza el canal en `mockSupabase` y dejaría
 * obsoleta cualquier referencia que el test haya capturado.
 */
async function mountAndSubscribe(queryClient: QueryClient): Promise<void> {
  renderNotifier(queryClient);
  await waitFor(() => expect(mockSupabase.getChannel(TOPIC)).toBeTruthy());
  act(() => {
    mockSupabase.getChannel(TOPIC)!.emitStatus('SUBSCRIBED');
  });
}

async function emitListUpdate(newRow: Partial<OmiConversation>): Promise<void> {
  await act(async () => {
    mockSupabase.getChannel(TOPIC)!.emitChange({ new: newRow });
  });
}

/** Primer elemento de la queryKey del filtro pasado a invalidateQueries. */
function invalidateKeyHead(call: unknown[]): unknown {
  const filters = call[0] as { queryKey?: unknown[] } | undefined;
  return filters?.queryKey?.[0];
}

describe('GlobalConversationNotifier', () => {
  beforeEach(() => {
    mockSupabase.reset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('un UPDATE que solo mueve updated_at (heartbeat) no invalida ni parchea la lista', async () => {
    const queryClient = makeQueryClient();
    const rows = [
      makeConversation({ id: 'conv-1' }),
      makeConversation({ id: 'conv-2' }),
      makeConversation({ id: 'conv-3' }),
    ];
    queryClient.setQueryData(LIST_KEY, rows);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await mountAndSubscribe(queryClient);

    const before = queryClient.getQueryData(LIST_KEY);

    await emitListUpdate({
      ...rows[0],
      updated_at: new Date(Date.now() + 30_000).toISOString(),
    });

    // Misma referencia de array: setQueriesData nunca se llamó porque la
    // comparación va ANTES de tocar la caché.
    const after = queryClient.getQueryData(LIST_KEY);
    expect(after).toBe(before);

    const listInvalidates = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversations',
    );
    expect(listInvalidates).toHaveLength(0);

    // El detalle sí se invalida siempre (useConversationLive/su watchdog lo necesitan).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['omi-conversation', 'conv-1'] });
  });

  it('un UPDATE que cambia analysis_status parchea la fila en caché y no invalida la lista', async () => {
    const queryClient = makeQueryClient();
    const rows = [
      makeConversation({ id: 'conv-1', analysis_status: 'processing' }),
      makeConversation({ id: 'conv-2', analysis_status: 'completed' }),
    ];
    queryClient.setQueryData(LIST_KEY, rows);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await mountAndSubscribe(queryClient);

    await emitListUpdate({
      ...rows[0],
      analysis_status: 'completed',
      updated_at: new Date(Date.now() + 30_000).toISOString(),
    });

    const after = queryClient.getQueryData<OmiConversation[]>(LIST_KEY);
    expect(after?.find((c) => c.id === 'conv-1')?.analysis_status).toBe('completed');
    // El resto del array queda intacto (mismo objeto de referencia incluso).
    expect(after?.find((c) => c.id === 'conv-2')).toBe(rows[1]);

    const listInvalidates = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversations',
    );
    expect(listInvalidates).toHaveLength(0);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['omi-conversation', 'conv-1'] });
  });

  it('un UPDATE de un id ausente de la caché invalida la lista, throttleado a 1 cada 30s', async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(LIST_KEY, [makeConversation({ id: 'conv-1' })]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await mountAndSubscribe(queryClient);

    const missingRow = makeConversation({ id: 'conv-999', analysis_status: 'processing' });

    await emitListUpdate(missingRow);

    const afterFirst = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversations',
    );
    expect(afterFirst).toHaveLength(1);

    // Segundo UPDATE inmediato de una fila igual de ausente: throttleado.
    await emitListUpdate({ ...missingRow, updated_at: new Date().toISOString() });

    const afterSecond = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversations',
    );
    expect(afterSecond).toHaveLength(1); // sigue en 1, no se duplicó

    // El detalle se invalida en ambos UPDATEs, sin throttle.
    const detailInvalidates = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversation',
    );
    expect(detailInvalidates.length).toBeGreaterThanOrEqual(2);

    // Pasado el throttle de 30s, un tercer UPDATE sí vuelve a invalidar.
    await act(async () => {
      vi.advanceTimersByTime(30_001);
    });
    await emitListUpdate({ ...missingRow, updated_at: new Date().toISOString() });

    const afterThird = invalidateSpy.mock.calls.filter(
      (call) => invalidateKeyHead(call) === 'omi-conversations',
    );
    expect(afterThird).toHaveLength(2);
  });
});
