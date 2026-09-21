// Test desktop (no existe en la web): contrato de las adaptaciones del GamifiedDashboardV2 portado.
//  - "Empezar a grabar" usa el puente del Sidebar, nunca router.push('/') a secas (docs/UI_REGLAS.md).
//  - Momentos solo recibe conversaciones con isFullAnalysis(v4) (#72).
//  - Sin links a /avatar ni /expedicion en el propio dashboard.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pathname: '/',
  push: vi.fn(),
  data: {} as Record<string, unknown>,
  moments: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ userProfile: { id: 'maity-user-id', first_name: 'Ana', name: 'Ana Pérez' } }) }));
vi.mock('../../hooks/useGamifiedDashboardDataV2', () => ({ useGamifiedDashboardDataV2: () => h.data }));
vi.mock('../../hooks/useProgressChartsData', () => ({
  useProgressChartsData: () => ({ radarData: [], sessionHistory: [], fillerWordsInsight: '', trendData: [], dimensionSummary: [], radarInsight: '', loading: false, hasData: false }),
}));
vi.mock('@/features/gamification/hooks/useFormResponsesRadar', () => ({ useFormResponsesRadar: () => ({ radarData: [], loading: false }) }));
vi.mock('./LazyDashboardPanels', () => ({
  LazyConversationMoments: (props: { conversations: unknown[] }) => { h.moments(props.conversations); return <div>momentos</div>; },
  LazyPerformanceSummary: () => <div>contexto</div>,
}));
vi.mock('./ExpeditionPilot', () => ({ ExpeditionPilot: (props: { userId?: string }) => <div data-testid="pilot">{props.userId}</div> }));

import { GamifiedDashboardV2 } from './GamifiedDashboardV2';

const baseData = (conversations: unknown[]) => ({
  loading: false,
  conversations,
  competencies: [{ name: 'Claridad', value: 60, color: '#000' }, { name: 'Empatía', value: 40, color: '#000' }],
  xp: 120,
  nextLevelXP: 500,
  level: 1,
  rank: 'Explorador',
  streak: 3,
  ranking: [],
});

beforeEach(() => {
  h.pathname = '/';
  h.push.mockReset();
  h.moments.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

function openEvolution() {
  const tab = screen.getByRole('tab', { name: 'Evolución' });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.focus(tab);
}

describe('GamifiedDashboardV2 (desktop)', () => {
  it('passes maityUser.id to the expedition and only full V4 analyses to Momentos', () => {
    const full = { id: 'a', created_at: '2026-09-10', communication_feedback_v4: { calidad_global: { puntaje: 70 } } };
    const skipped = { id: 'b', created_at: '2026-09-11', communication_feedback_v4: { status: 'skipped' } };
    const pending = { id: 'c', created_at: '2026-09-12', communication_feedback_v4: null };
    h.data = baseData([full, skipped, pending]);
    render(<GamifiedDashboardV2 />);
    expect(screen.getByTestId('pilot').textContent).toBe('maity-user-id');
    expect(h.moments).toHaveBeenLastCalledWith([full]);
  });

  it('starts recording through the sidebar bridge when already on the home', () => {
    h.data = baseData([]);
    const listener = vi.fn();
    window.addEventListener('start-recording-from-sidebar', listener);
    render(<GamifiedDashboardV2 />);
    openEvolution();
    fireEvent.click(screen.getByRole('button', { name: /Empezar a grabar/ }));
    window.removeEventListener('start-recording-from-sidebar', listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('from another route it flags autoStartRecording and navigates home', () => {
    h.pathname = '/gamification';
    h.data = baseData([]);
    render(<GamifiedDashboardV2 />);
    openEvolution();
    fireEvent.click(screen.getByRole('button', { name: /Empezar a grabar/ }));
    expect(sessionStorage.getItem('autoStartRecording')).toBe('true');
    expect(h.push).toHaveBeenCalledWith('/');
  });

  it('does not link to the out-of-scope avatar studio or expedition atlas', () => {
    h.data = baseData([]);
    render(<GamifiedDashboardV2 />);
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => /\/(avatar|expedicion)/.test(href))).toEqual([]);
  });
});
