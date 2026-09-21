// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ExpeditionPilot.test.tsx
// Versión desktop: sin MemoryRouter (Link de @/lib/router-compat), next/navigation mockeado;
// VoxelAvatar → DashboardPortrait (retrato 2D); /avatar, /skills-arena y /learning-path solo
// existen en la web → los links abren https://www.maity.cloud/<ruta>. Se añade un caso para el
// stub real `useLearningPath` del desktop (sin ruta, sin llamada de red).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningPathNode } from '@maity/shared';
import { ExpeditionPilot } from './ExpeditionPilot';
import { expeditionWindow, SAMPLE_STOPS, conqueredTrail } from './expedition-model';

const WEB = 'https://www.maity.cloud';
const state = vi.hoisted(() => ({ value: { isLoading: false, error: new Error('Unavailable'), isFetching: false, data: undefined, refetch: vi.fn() } as Record<string, unknown> }));
vi.mock('@maity/shared', () => ({ useLearningPath: () => state.value, bossAsset: () => '/boss.webp', gearAsset: () => '/medal.webp', COSMETIC_REWARDS: [{ id: 'medal', name: 'Medalla de cumbre', requirement: 'Supera tu primer jefe · primer hito completado' }] }));
vi.mock('@/features/dashboard/adapters/DashboardPortrait', () => ({ DashboardPortrait: () => <span>Personaje guardado</span> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: vi.fn() }));
const mount = () => render(<ExpeditionPilot userId="user" avatar={{}} />);
afterEach(() => { cleanup(); state.value = { isLoading: false, error: new Error('Unavailable'), isFetching: false, data: undefined, refetch: vi.fn() }; });

describe('Expedition pilot', () => {
  it('celebrates only a newly confirmed completion, not initial or repeated data', () => {
    const node = { ...SAMPLE_STOPS[1], nodeId: 'server', orderIndex: 1, nodeType: 'checkpoint' };
    state.value = { ...state.value, error: null, data: { nodes: [node] } };
    const view = mount();
    expect(screen.queryByText('¡Hito completado!')).toBeNull();
    state.value = { ...state.value, data: { nodes: [{ ...node, status: 'completed' }] } };
    view.rerender(<ExpeditionPilot userId="user" avatar={{}} />);
    expect(screen.getByText('¡Hito completado!')).toBeTruthy();
    expect(screen.getByText('Medalla de cumbre disponible en tu equipo.')).toBeTruthy();
    view.unmount();
    mount();
    expect(screen.queryByText('¡Hito completado!')).toBeNull();
  });
  it('never credits one account with a completion observed under another', () => {
    const node = { ...SAMPLE_STOPS[1], nodeId: 'server', orderIndex: 1, nodeType: 'checkpoint' };
    state.value = { ...state.value, error: null, data: { nodes: [node] } };
    const view = mount();
    state.value = { ...state.value, data: { nodes: [{ ...node, status: 'completed' }] } };
    view.rerender(<ExpeditionPilot userId="otro" avatar={{}} />);
    expect(screen.queryByText('¡Hito completado!')).toBeNull();
  });
  it('colors only earned connections, never skipped or locked stages', () => {
    expect(conqueredTrail(SAMPLE_STOPS, SAMPLE_STOPS[1].nodeId)).toHaveLength(1);
    expect(conqueredTrail(SAMPLE_STOPS.map(n => ({ ...n, status: 'locked' })), null)).toEqual([]);
    const skipped = SAMPLE_STOPS.map((n, i) => i === 0 ? { ...n, status: 'skipped' as const } : n);
    expect(conqueredTrail(skipped, SAMPLE_STOPS[1].nodeId)).toEqual([]);
    expect(conqueredTrail([], null)).toEqual([]);
  });
  it('keeps the next-action marker on actual progress when inspecting a locked stage', () => {
    mount();
    const current = screen.getByRole('button', { name: /2. Escucha antes de responder/ });
    const locked = screen.getByRole('button', { name: /9. El reto de la cumbre/ });
    fireEvent.click(locked);
    expect(current.classList.contains('is-current')).toBe(true);
    expect(locked.classList.contains('is-current')).toBe(false);
  });
  it('shows the boss and catalog reward as previews, without a claim action', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Conocer a El Regateador, jefe de muestra' }).getAttribute('href')).toBe(`${WEB}/avatar`);
    expect(screen.getByRole('img', { name: 'Medalla de cumbre' })).toBeTruthy();
    expect(screen.getByText('Supera tu primer jefe · primer hito completado')).toBeTruthy();
    expect(screen.getByText('Consultar no reclama ni desbloquea premios.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reclamar/i })).toBeNull();
  });
  it('labels unavailable progress as a sample, with no invented earned rewards', () => {
    mount();
    expect(screen.queryByText('Recorrido ilustrativo')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('no representa tus avances');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(state.value.refetch).toHaveBeenCalledOnce();
  });
  it('explains a locked sample without unlocking or moving the character', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /3. Construye tu argumento/ }));
    expect(screen.getByRole('heading', { name: 'Construye tu argumento' })).toBeTruthy();
    expect(screen.getByText(/se abre al completar el hito anterior/)).toBeTruthy();
    expect(screen.getByLabelText('Tu personaje en una posición de ejemplo')).toBeTruthy();
    expect(screen.queryByText('Continuar en mi ruta')).toBeNull();
  });
  it('reveals an optional working practice destination without awarding XP', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Explorar un desvío' }));
    expect(screen.getByRole('link', { name: /Elegir una práctica/ }).getAttribute('href')).toBe(`${WEB}/skills-arena`);
    expect(screen.getByText('Explorar no entrega XP ni desbloquea equipo.')).toBeTruthy();
  });
  it('uses server status and description when a route is available', () => {
    state.value = { ...state.value, error: null, data: { nodes: [{ ...SAMPLE_STOPS[1], nodeId: 'real', title: 'Misión real', description: 'Objetivo del servidor', orderIndex: 1 }] } };
    mount();
    expect(screen.queryByText('Recorrido ilustrativo')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Misión real' })).toBeTruthy();
    expect(screen.getByLabelText('Tu personaje en el hito actual')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Continuar en mi ruta/ }).getAttribute('href')).toBe(`${WEB}/learning-path`);
  });
  it('ignores cached progress when its refresh fails', () => {
    state.value.data = { nodes: [{ ...SAMPLE_STOPS[1], title: 'Stale mission', orderIndex: 1 }] };
    mount();
    expect(screen.queryByText('Stale mission')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Tu ruta no está disponible');
  });
  it('keeps the current node visible and does not confuse skipped with completed', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ ...SAMPLE_STOPS[0], nodeId: String(i), orderIndex: i, status: i === 9 ? 'in_progress' : i < 9 ? 'skipped' : 'locked' })) as LearningPathNode[];
    const result = expeditionWindow(nodes.reverse());
    expect(result.currentId).toBe('9');
    expect(result.start).toBe(8);
    expect(result.total).toBe(12);
    expect(result.stops.map(n => n.nodeId)).toEqual(['8', '9', '10', '11']);
    expect(result.stops[0].status).toBe('skipped');
    expect(expeditionWindow([]).currentId).toBeNull();
  });
  it('shows the honest "no route" sample with the desktop stub (no RPC)', () => {
    state.value = { isLoading: false, error: null, isFetching: false, data: undefined, refetch: vi.fn() };
    mount();
    expect(screen.getByRole('status').textContent).toContain('Aún no hay una ruta asignada');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
});
