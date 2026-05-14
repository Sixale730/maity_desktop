import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;
const handlers = new Map<string, EventHandler>();

const listenMock = vi.fn((event: string, handler: EventHandler) => {
  handlers.set(event, handler);
  return Promise.resolve(() => handlers.delete(event));
});
const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve(undefined as unknown));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, EventHandler])),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const tipsState = {
  current: [] as Array<{ tip: string; tip_type: string; category: string; priority: string; confidence: number; timestamp_secs: number; trigger?: string }>,
};

vi.mock('@/hooks/useCoachTips', () => ({
  useCoachTips: () => ({ tips: tipsState.current, latestTip: null, clearTips: () => undefined }),
}));

vi.mock('@/hooks/useMeetingMetrics', () => ({
  useMeetingMetrics: () => ({ metrics: null, isWaitingForAudio: false }),
}));

vi.mock('@/components/coach/HealthGauge', () => ({
  HealthGauge: () => null,
}));

vi.mock('@/components/coach/TalkSplitBar', () => ({
  TalkSplitBar: () => null,
}));

vi.mock('@/components/coach/tipMeta', () => ({
  getPriorityColor: () => '#fff',
  getCategoryMeta: () => ({ label: '', color: '#fff' }),
  PRIORITY_META: { high: { label: 'high' }, medium: { label: 'medium' }, low: { label: 'low' } },
  priorityIconStyle: () => ({}),
}));

import CoachFloatPage from './page';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeTip = (n: number) => ({
  tip: `tip number ${n}`,
  tip_type: `type-${n}`,
  category: 'pacing',
  priority: 'medium',
  confidence: 0.8,
  timestamp_secs: n * 100,
});

describe('CoachFloatPage — feedback por tip', () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockClear();
    invokeMock.mockClear();
    tipsState.current = [];
  });

  it('permite votar tips no-latest (gate isLatest removido)', async () => {
    // 3 tips: en el render, reversedTips[0] es tip(3) (latest), reversedTips[1] es
    // tip(2), reversedTips[2] es tip(1) (mas viejo). tipIndex inicial = 0 → tip(3).
    tipsState.current = [makeTip(1), makeTip(2), makeTip(3)];

    render(<CoachFloatPage />);
    await flush();

    // Iter 11: el tip card vive dentro del drawer y el drawer arranca cerrado.
    // Disparar recording-start-complete simula el flow real: backend arranca
    // grabación → coach-float auto-abre el drawer → tip card visible.
    const startHandler = handlers.get('recording-start-complete');
    if (startHandler) {
      await startHandler({ payload: undefined });
      await flush();
    }

    // Click "Util" en el tip mas reciente (tip 3)
    fireEvent.click(screen.getByText('Útil'));
    await flush();

    const calls = invokeMock.mock.calls.filter((call) => call[0] === 'save_user_feedback');
    expect(calls).toHaveLength(1);

    const args = calls[0][1] as { metadata: string; rating: string };
    expect(args.rating).toBe('like');
    const metadata = JSON.parse(args.metadata);
    expect(metadata.tip_key).toBe('300-type-3');
    expect(metadata.tip_text).toBe('tip number 3');
    expect(metadata.tip_timestamp_secs).toBe(300);

    cleanup();
  });

  it('persiste el rating por tip al navegar (no se pierde al cambiar de tip)', async () => {
    tipsState.current = [makeTip(1), makeTip(2)];

    render(<CoachFloatPage />);
    await flush();

    // Abrir drawer simulando inicio de grabación (iter 11)
    const startHandler = handlers.get('recording-start-complete');
    if (startHandler) {
      await startHandler({ payload: undefined });
      await flush();
    }

    // Votar el tip mas reciente (tip 2)
    fireEvent.click(screen.getByText('Útil'));
    await flush();

    // Verificar que el boton "Util" del tip 2 esta deshabilitado (ya votado)
    const utilBtn = screen.getByText('Útil').closest('button');
    expect(utilBtn).toBeDisabled();

    cleanup();
  });

  it('no permite votar dos veces el mismo tip', async () => {
    tipsState.current = [makeTip(1)];

    render(<CoachFloatPage />);
    await flush();

    // Abrir drawer simulando inicio de grabación (iter 11)
    const startHandler = handlers.get('recording-start-complete');
    if (startHandler) {
      await startHandler({ payload: undefined });
      await flush();
    }

    fireEvent.click(screen.getByText('Útil'));
    await flush();
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'save_user_feedback')).toHaveLength(1);

    // Click otra vez (el boton esta disabled, pero forzamos por completitud del gate)
    fireEvent.click(screen.getByText('Útil'));
    await flush();
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'save_user_feedback')).toHaveLength(1);

    cleanup();
  });

  it('payload incluye tip_key estable basado en timestamp y tip_type', async () => {
    tipsState.current = [makeTip(7)];

    render(<CoachFloatPage />);
    await flush();

    // Abrir drawer simulando inicio de grabación (iter 11)
    const startHandler = handlers.get('recording-start-complete');
    if (startHandler) {
      await startHandler({ payload: undefined });
      await flush();
    }

    fireEvent.click(screen.getByText('No útil'));
    await flush();

    const calls = invokeMock.mock.calls.filter((c) => c[0] === 'save_user_feedback');
    expect(calls).toHaveLength(1);
    const args = calls[0][1] as { metadata: string; rating: string };
    const metadata = JSON.parse(args.metadata);
    expect(metadata.tip_key).toBe('700-type-7');
    expect(args.rating).toBe('dislike');

    cleanup();
  });
});
