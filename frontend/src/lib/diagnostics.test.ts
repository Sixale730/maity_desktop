import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const infoMock = vi.fn();

vi.mock('./fileLogger', () => ({
  fileLogger: {
    info: (...args: unknown[]) => infoMock(...args),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logPollIfChanged, resetPollLogState, POLL_LOG_HEARTBEAT_MS } from './diagnostics';

/**
 * `logPollIfChanged` (#25 de la auditoría de recursos): el poll del detalle y
 * los UPDATE de Realtime emitían ~60-80 IPC/min casi idénticos. Estos tests
 * fijan el contrato del muestreo: primera emisión, dedupe por firma, emisión
 * inmediata al cambiar, latido de 60 s con `suppressed`, aislamiento por clave.
 */
describe('logPollIfChanged', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    infoMock.mockClear();
    resetPollLogState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Entradas que llegaron al archivo (3.er argumento de `fileLogger.info`). */
  const entries = () => infoMock.mock.calls.map((c) => c[2] as Record<string, unknown>);

  it('emite la primera llamada y suprime las repeticiones con la misma firma', () => {
    logPollIfChanged('k', 'ev', { a: 1, fetch_status: 'fetching' }, ['x']);
    logPollIfChanged('k', 'ev', { a: 1, fetch_status: 'idle' }, ['x']);
    logPollIfChanged('k', 'ev', { a: 1, fetch_status: 'fetching' }, ['x']);

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock.mock.calls[0][0]).toBe('POLL');
    expect(infoMock.mock.calls[0][1]).toBe('ev');
    expect(entries()[0]).toMatchObject({ event: 'ev', a: 1, fetch_status: 'fetching' });
    expect(entries()[0]).not.toHaveProperty('heartbeat');
    expect(entries()[0]).not.toHaveProperty('suppressed');
  });

  it('emite al instante cuando cambia la firma y anota cuántas se callaron', () => {
    logPollIfChanged('k', 'ev', { s: 'processing' }, ['processing']);
    logPollIfChanged('k', 'ev', { s: 'processing' }, ['processing']);
    logPollIfChanged('k', 'ev', { s: 'processing' }, ['processing']);
    logPollIfChanged('k', 'ev', { s: 'completed' }, ['completed']);

    expect(infoMock).toHaveBeenCalledTimes(2);
    expect(entries()[1]).toMatchObject({ s: 'completed', suppressed: 2 });
    expect(entries()[1]).not.toHaveProperty('heartbeat');
  });

  it('emite un latido pasado POLL_LOG_HEARTBEAT_MS aunque nada cambie', () => {
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    vi.advanceTimersByTime(POLL_LOG_HEARTBEAT_MS - 1);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    expect(infoMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    expect(infoMock).toHaveBeenCalledTimes(2);
    expect(entries()[1]).toMatchObject({ s: 1, heartbeat: true, suppressed: 1 });
  });

  it('el latido reinicia el contador de suprimidas', () => {
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    vi.advanceTimersByTime(POLL_LOG_HEARTBEAT_MS);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    expect(entries()[1]).toMatchObject({ heartbeat: true, suppressed: 2 });

    vi.advanceTimersByTime(POLL_LOG_HEARTBEAT_MS);
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    expect(entries()[2]).toMatchObject({ heartbeat: true, suppressed: 0 });
  });

  it('las claves son independientes', () => {
    logPollIfChanged('a', 'ev', { s: 1 }, [1]);
    logPollIfChanged('b', 'ev', { s: 1 }, [1]);
    logPollIfChanged('a', 'ev', { s: 1 }, [1]);
    logPollIfChanged('b', 'ev', { s: 1 }, [1]);
    expect(infoMock).toHaveBeenCalledTimes(2);
  });

  it('la firma manda: campos volátiles fuera de ella no reventan el dedupe', () => {
    logPollIfChanged('k', 'ev', { updated_at: 't1', status: 'processing' }, ['processing']);
    logPollIfChanged('k', 'ev', { updated_at: 't2', status: 'processing' }, ['processing']);
    expect(infoMock).toHaveBeenCalledTimes(1);
  });

  it('resetPollLogState olvida lo emitido', () => {
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    resetPollLogState();
    logPollIfChanged('k', 'ev', { s: 1 }, [1]);
    expect(infoMock).toHaveBeenCalledTimes(2);
  });

  it('el tope de claves descarta la más vieja', () => {
    for (let i = 0; i < 256; i++) logPollIfChanged(`k${i}`, 'ev', {}, [i]);
    infoMock.mockClear();

    logPollIfChanged('k256', 'ev', {}, [256]); // entra k256, sale k0
    logPollIfChanged('k1', 'ev', {}, [1]); // k1 sigue viva: se suprime
    logPollIfChanged('k0', 'ev', {}, [0]); // k0 fue desalojada: vuelve a emitir

    expect(infoMock).toHaveBeenCalledTimes(2);
    expect(infoMock.mock.calls.map((c) => (c[2] as { event: string }).event)).toEqual(['ev', 'ev']);
  });
});
