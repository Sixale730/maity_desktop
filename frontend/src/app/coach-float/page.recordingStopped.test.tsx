import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;
const handlers = new Map<string, EventHandler>();

const listenMock = vi.fn(async (event: string, handler: EventHandler) => {
  handlers.set(event, handler);
  return () => handlers.delete(event);
});
const invokeMock = vi.fn(async () => undefined);

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: EventHandler) => listenMock(event, handler),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
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

describe('CoachFloatPage — auto-close on recording-stopped', () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockClear();
    invokeMock.mockClear();
  });

  it('subscribes to recording-stopped on mount', async () => {
    render(<CoachFloatPage />);
    await flush();

    const subscribed = listenMock.mock.calls.map(([event]) => event);
    expect(subscribed).toContain('recording-stopped');
    cleanup();
  });

  it('invokes close_floating_coach exactly once when recording-stopped fires', async () => {
    render(<CoachFloatPage />);
    await flush();

    const handler = handlers.get('recording-stopped');
    expect(handler).toBeDefined();
    await handler!({ payload: undefined });
    await flush();

    const closeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'close_floating_coach');
    expect(closeCalls).toHaveLength(1);
    cleanup();
  });

  it('does NOT invoke close_floating_coach when only recording-audio-levels fires', async () => {
    render(<CoachFloatPage />);
    await flush();

    const handler = handlers.get('recording-audio-levels');
    expect(handler).toBeDefined();
    await handler!({ payload: { micRms: 0.1, micPeak: 0.2, sysRms: 0.05, sysPeak: 0.1 } });
    await flush();

    const closeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'close_floating_coach');
    expect(closeCalls).toHaveLength(0);
    cleanup();
  });
});
