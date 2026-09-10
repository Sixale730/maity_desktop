/**
 * `useMeetingMetrics` (F5): en modo lote el coach mide por audio y los turnos
 * van siempre en 0 (no hay texto). Sin ramificar por `mode`, el gauge del
 * coach flotante diría "Esperando audio" durante toda la sesión aunque el
 * usuario llevara diez minutos hablando.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (e: { payload: unknown }) => void;
const handlers: Record<string, Handler> = {};
const disposeMock = vi.fn();

vi.mock('@/lib/tauriSubscribe', () => ({
  createSubscriptionGroup: () => ({
    on: (event: string, handler: Handler) => {
      handlers[event] = handler;
    },
    add: vi.fn(),
    dispose: disposeMock,
    get isDisposed() {
      return false;
    },
  }),
}));

import { useMeetingMetrics, computeIsWaitingForAudio, type MeetingMetrics } from './useMeetingMetrics';

function base(overrides: Partial<MeetingMetrics> = {}): MeetingMetrics {
  return {
    health: 70,
    userTalkPct: 50,
    interlocutorTalkPct: 50,
    sessionSecs: 30,
    userTurns: 0,
    interlocutorTurns: 0,
    ...overrides,
  };
}

describe('computeIsWaitingForAudio', () => {
  it('sin métricas siempre espera', () => {
    expect(computeIsWaitingForAudio(null)).toBe(true);
  });

  it('modo transcript (o sin modo, Rust viejo): espera mientras ambos turnos sean 0', () => {
    expect(computeIsWaitingForAudio(base())).toBe(true);
    expect(computeIsWaitingForAudio(base({ mode: 'transcript' }))).toBe(true);
    expect(computeIsWaitingForAudio(base({ userTurns: 1 }))).toBe(false);
    expect(computeIsWaitingForAudio(base({ mode: 'transcript', interlocutorTurns: 2 }))).toBe(false);
  });

  it('modo audio: espera SOLO hasta que haya voz, aunque los turnos sigan en 0', () => {
    expect(computeIsWaitingForAudio(base({ mode: 'audio', voiced: false }))).toBe(true);
    expect(computeIsWaitingForAudio(base({ mode: 'audio' }))).toBe(true); // voiced ausente = sin voz
    expect(computeIsWaitingForAudio(base({ mode: 'audio', voiced: true }))).toBe(false);
  });
});

describe('useMeetingMetrics', () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) delete handlers[key];
    disposeMock.mockReset();
  });

  it('guarda el último payload y deriva isWaitingForAudio por modo', () => {
    const { result } = renderHook(() => useMeetingMetrics());
    expect(result.current.metrics).toBeNull();
    expect(result.current.isWaitingForAudio).toBe(true);

    act(() => {
      handlers['meeting-metrics']({ payload: base({ mode: 'audio', voiced: false, sessionSecs: 5 }) });
    });
    expect(result.current.metrics?.sessionSecs).toBe(5);
    expect(result.current.isWaitingForAudio).toBe(true);

    act(() => {
      handlers['meeting-metrics']({ payload: base({ mode: 'audio', voiced: true, sessionSecs: 8, userTalkPct: 90, interlocutorTalkPct: 10 }) });
    });
    expect(result.current.isWaitingForAudio).toBe(false);
    expect(result.current.metrics?.userTalkPct).toBe(90);
  });

  it('resetea a null al arrancar y al detener (start-complete, stop-complete, recording-stopped)', () => {
    const { result } = renderHook(() => useMeetingMetrics());

    for (const resetEvent of ['recording-start-complete', 'recording-stop-complete', 'recording-stopped']) {
      act(() => {
        handlers['meeting-metrics']({ payload: base({ mode: 'audio', voiced: true }) });
      });
      expect(result.current.metrics).not.toBeNull();

      act(() => {
        handlers[resetEvent]({ payload: null });
      });
      expect(result.current.metrics, resetEvent).toBeNull();
      expect(result.current.isWaitingForAudio).toBe(true);
    }
  });

  it('libera las suscripciones al desmontar', () => {
    const { unmount } = renderHook(() => useMeetingMetrics());
    unmount();
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });
});
