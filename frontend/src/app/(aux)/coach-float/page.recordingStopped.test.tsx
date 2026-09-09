import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

vi.mock('@/hooks/useCoachTips', () => ({
  useCoachTips: () => ({ tips: [] }),
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
  getCategoryMeta: () => null,
  PRIORITY_META: {},
  priorityIconStyle: () => ({}),
}));

import CoachFloatPage from './page';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CoachFloatPage — auto-close drawer on recording-stopped', () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockClear();
    invokeMock.mockClear();
  });

  it('subscribes to recording-stopped on mount', async () => {
    render(<CoachFloatPage />);
    await flush();

    const subscribed = listenMock.mock.calls.map((call) => call[0]);
    expect(subscribed).toContain('recording-stopped');
    cleanup();
  });

  it('invokes coach_float_set_size with drawer:false when recording-stopped fires', async () => {
    render(<CoachFloatPage />);
    await flush();

    const handler = handlers.get('recording-stopped');
    expect(handler).toBeDefined();
    await handler!({ payload: undefined });
    await flush();

    // Iter 11+: ya no cerramos la ventana al stop — solo cerramos el drawer.
    // La ventana flotante es ahora UI permanente (compact bar always on).
    const setSizeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'coach_float_set_size');
    expect(setSizeCalls.length).toBeGreaterThanOrEqual(1);
    // El último set_size debe ser drawer:false (cerrar drawer al detener)
    const lastSetSize = setSizeCalls[setSizeCalls.length - 1];
    expect(lastSetSize[1]).toEqual({ drawer: false });
    cleanup();
  });

  it('does NOT close drawer when only recording-audio-levels fires', async () => {
    render(<CoachFloatPage />);
    await flush();

    const handler = handlers.get('recording-audio-levels');
    expect(handler).toBeDefined();
    await handler!({ payload: { micRms: 0.1, micPeak: 0.2, sysRms: 0.05, sysPeak: 0.1 } });
    await flush();

    const setSizeCalls = invokeMock.mock.calls.filter((call) => call[0] === 'coach_float_set_size');
    expect(setSizeCalls).toHaveLength(0);
    cleanup();
  });
});
