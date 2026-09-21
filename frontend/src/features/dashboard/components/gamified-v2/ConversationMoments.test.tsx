// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ConversationMoments.test.tsx
// Versión desktop: sin MemoryRouter (el Link de @/lib/router-compat es next/link) y con
// next/navigation mockeado; /conversaciones/:id se sirve como /conversations?id=:id.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OmiConversationListItem } from '@/features/omi/services/omi.service';
import { ConversationMoments } from './ConversationMoments';

const { fetchSegments } = vi.hoisted(() => ({ fetchSegments: vi.fn() }));
vi.mock('@/features/omi/services/omi.service', () => ({ getOmiTranscriptSegments: fetchSegments }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: vi.fn() }));
beforeEach(() => { fetchSegments.mockReset().mockResolvedValue([]); });
afterEach(cleanup);
const conv = (id = 'one'): OmiConversationListItem => ({ id, user_id: 'u', created_at: '2026-09-16T12:00:00Z', title: `Conversación ${id}`, overview: '', emoji: null, category: null, source: null, words_count: 30, duration_seconds: 60, communication_feedback: null, communication_feedback_v4: { calidad_global: { fortaleza: 'claridad', fortaleza_hint: 'Una idea concreta', mejorar: 'proposito', mejorar_hint: 'Falta un cierre' }, dimensiones: { proposito: { puntaje: 50, hallazgos: [{ cita: 'Te envío el resumen mañana', alternativa: 'Confirmemos el siguiente paso.' }] } } } });
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
it('shows an honest empty state without fetching or creating scores', () => {
  render(<ConversationMoments conversations={[]}/>, { wrapper: wrapper() });
  expect(screen.getByText('Tu conversación tiene pistas')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ver conversaciones/ }).getAttribute('href')).toBe('/conversations');
  expect(fetchSegments).not.toHaveBeenCalled();
});
it('switches feedback, verifies a quote and offers transcript context without a fake audio control', async () => {
  fetchSegments.mockResolvedValue([{ conversation_id: 'one', is_user: true, text: 'Te envío el resumen mañana', start_time: 24 }]);
  render(<ConversationMoments conversations={[conv()]}/>, { wrapper: wrapper() });
  await screen.findByText('Fragmento · 0:24');
  fireEvent.click(screen.getByText('Fragmento · 0:24'));
  expect(screen.getByText('Contexto: Te envío el resumen mañana')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Funcionó' }));
  expect(screen.getByText('Una idea concreta')).toBeTruthy();
  expect(screen.queryByText('Confirmemos el siguiente paso.')).toBeNull();
  expect(screen.getByRole('link').getAttribute('href')).toBe('/conversations?id=one');
});
it('does not retain a previous session quote after changing conversation', async () => {
  fetchSegments.mockImplementation(async (id: string) => id === 'one' ? [{ conversation_id: 'one', is_user: true, text: 'Te envío el resumen mañana', start_time: 24 }] : []);
  const view = render(<ConversationMoments conversations={[conv()]}/>, { wrapper: wrapper() });
  await screen.findByText('Fragmento · 0:24');
  view.rerender(<ConversationMoments conversations={[conv('two')]}/>);
  await waitFor(() => expect(fetchSegments).toHaveBeenCalledWith('two'));
  expect(screen.queryByText('Fragmento · 0:24')).toBeNull();
});
it('keeps existing analysis accessible when transcript retrieval fails', async () => {
  fetchSegments.mockRejectedValue(new Error('unavailable'));
  render(<ConversationMoments conversations={[conv()]}/>, { wrapper: wrapper() });
  await screen.findByText('No se pudo verificar el fragmento.');
  expect(screen.getByText('Falta un cierre')).toBeTruthy();
});
