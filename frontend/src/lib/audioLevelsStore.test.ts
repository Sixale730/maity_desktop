import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;
const handlers = new Map<string, EventHandler>();

const listenMock = vi.fn((event: string, handler: EventHandler) => {
  handlers.set(event, handler);
  // Retorno `void` explícito (bloque, no expresión): así TS infiere
  // `UnlistenFn = () => void` para `listenMock`, y cualquier otro unlisten
  // (p. ej. `() => Promise<void>` en el test de ref-count) sigue siendo
  // asignable — `void` acepta cualquier tipo de retorno por la regla laxa
  // de TS, `boolean` (lo que devuelve `Map.delete` como expresión) no.
  return Promise.resolve(() => { handlers.delete(event); });
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, EventHandler])),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Tests de `audioLevelsStore` (issue #07 de la auditoría de recursos).
 *
 * `vi.resetModules()` + `import()` dinámico por test: el módulo es un
 * singleton con estado a nivel de módulo (`snapshot`, `subscribers`, etc.),
 * así que sin resetear el registro de módulos un test contaminaría al
 * siguiente. Mismo patrón que `hooks/useUserRole.test.tsx`.
 *
 * `requestAnimationFrame` se stubea para correr SINCRÓNICAMENTE: el store
 * coalesce notificaciones con rAF + tope de 4 Hz, y sin este stub los tests
 * dependerían del scheduler real de rAF de jsdom (lento/no determinista).
 */
describe('audioLevelsStore (issue #07)', () => {
  beforeEach(() => {
    vi.resetModules();
    handlers.clear();
    listenMock.mockReset();
    listenMock.mockImplementation((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return Promise.resolve(() => handlers.delete(event));
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enabled:false no se suscribe — cero listeners de Tauri adjuntados', async () => {
    const { useAudioLevels } = await import('./audioLevelsStore');
    const { result } = renderHook(() => useAudioLevels({ enabled: false }));
    await flush();

    expect(listenMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ micRms: 0, sysRms: 0 });
  });

  it('el epsilon suprime la notificacion cuando el delta es menor a 1e-3 en ambos canales', async () => {
    const { subscribe, getSnapshot } = await import('./audioLevelsStore');
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    await flush(); // deja que attachListeners() registre los handlers mockeados

    const handler = handlers.get('recording-audio-levels');
    expect(handler).toBeDefined();

    const before = getSnapshot();
    // Delta de 0.0005/0.0003 en mic/sys: por debajo del epsilon (1e-3). Rust
    // emite valores casi-iguales decenas de veces por segundo en silencio;
    // esto es exactamente lo que el epsilon debe absorber.
    await handler!({ payload: { micRms: 0.0005, micPeak: 0, sysRms: 0.0003, sysPeak: 0 } });

    expect(cb).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(before); // sin cambio real: misma referencia

    unsubscribe();
  });

  it('notifica cuando el delta SI supera el epsilon, con una snapshot nueva', async () => {
    const { subscribe, getSnapshot } = await import('./audioLevelsStore');
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    await flush();

    const handler = handlers.get('recording-audio-levels');
    const before = getSnapshot();

    await handler!({ payload: { micRms: 0.05, micPeak: 0, sysRms: 0.02, sysPeak: 0 } });

    expect(cb).toHaveBeenCalledTimes(1);
    const after = getSnapshot();
    expect(after).not.toBe(before);
    expect(after).toEqual({ micRms: 0.05, sysRms: 0.02 });

    unsubscribe();
  });

  it('getSnapshot devuelve la MISMA referencia en llamadas sucesivas sin cambios (previene el bucle infinito de useSyncExternalStore)', async () => {
    const { getSnapshot } = await import('./audioLevelsStore');
    const a = getSnapshot();
    const b = getSnapshot();
    expect(a).toBe(b);
  });

  it('adjunta los listeners de Tauri solo en el PRIMER suscriptor', async () => {
    const { subscribe } = await import('./audioLevelsStore');
    const unsub1 = subscribe(vi.fn());
    await flush();
    expect(listenMock).toHaveBeenCalledTimes(2); // RECORDING_AUDIO_LEVELS + AUDIO_LEVELS

    const unsub2 = subscribe(vi.fn());
    await flush();
    expect(listenMock).toHaveBeenCalledTimes(2); // el 2do suscriptor NO re-adjunta

    unsub1();
    unsub2();
  });

  it('suelta los listeners solo cuando el ULTIMO suscriptor se desuscribe', async () => {
    const un1 = vi.fn(() => Promise.resolve());
    const un2 = vi.fn(() => Promise.resolve());
    listenMock.mockImplementation((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      const fn = event === 'recording-audio-levels' ? un1 : un2;
      return Promise.resolve(fn);
    });

    const { subscribe } = await import('./audioLevelsStore');
    const unsub1 = subscribe(vi.fn());
    const unsub2 = subscribe(vi.fn());
    await flush();

    unsub1(); // queda un suscriptor vivo: no debe soltar todavia
    await flush();
    expect(un1).not.toHaveBeenCalled();
    expect(un2).not.toHaveBeenCalled();

    unsub2(); // ultimo suscriptor: ahora si suelta ambos
    await flush();
    expect(un1).toHaveBeenCalledTimes(1);
    expect(un2).toHaveBeenCalledTimes(1);
  });

  it('useAudioLevels({enabled:true}) refleja los niveles publicados por el store', async () => {
    const { useAudioLevels } = await import('./audioLevelsStore');
    const { result } = renderHook(() => useAudioLevels({ enabled: true }));
    await flush();

    const handler = handlers.get('recording-audio-levels');
    expect(handler).toBeDefined();

    await act(async () => {
      await handler!({ payload: { micRms: 0.1, micPeak: 0, sysRms: 0.2, sysPeak: 0 } });
    });

    expect(result.current).toEqual({ micRms: 0.1, sysRms: 0.2 });
  });

  it('resetAudioLevels fuerza los niveles a cero de inmediato y notifica', async () => {
    const { subscribe, getSnapshot, resetAudioLevels } = await import('./audioLevelsStore');
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    await flush();

    const handler = handlers.get('recording-audio-levels');
    await handler!({ payload: { micRms: 0.3, micPeak: 0, sysRms: 0.4, sysPeak: 0 } });
    expect(getSnapshot()).toEqual({ micRms: 0.3, sysRms: 0.4 });

    cb.mockClear();
    resetAudioLevels();

    expect(getSnapshot()).toEqual({ micRms: 0, sysRms: 0 });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
