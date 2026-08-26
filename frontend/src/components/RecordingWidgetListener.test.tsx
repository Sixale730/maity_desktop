/**
 * Regresión del issue #65.
 *
 * Este componente era el origen del `TypeError: Cannot read properties of
 * undefined (reading 'handlerId')` que aterrizaba como `unhandledrejection`
 * ~30-60 ms después de abrir la app (16 sesiones en telemetría). Se confirmó
 * mapeando la columna del stack (`app/layout-*.js:1:70210`) contra el chunk
 * real: caía exactamente sobre el `fn()` del cleanup `unlistenP.then(fn => fn())`.
 *
 * Causa: el componente pasaba un `() => {}` INLINE a `useRecordingStart`. Ese
 * arrow es dependencia de `handleRecordingStart`, así que cambiaba de identidad
 * en cada render, y el efecto de listeners lo llevaba en su dep array junto con
 * `selectedDevices`. Resultado: desuscribir + resuscribir al MISMO evento en
 * cada render.
 *
 * El invariante que protege este test es "se suscribe UNA vez", no "el cleanup
 * no truena": el latch idempotente de tauriSubscribe es la red, pero si el
 * componente vuelve a resuscribirse por render el bug de fondo está de vuelta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useState } from 'react';

const listenMock = vi.fn();
const handleRecordingStartMock = vi.fn();
const useRecordingStartMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (...args: unknown[]) => unknown) =>
    listenMock(event, handler),
}));

vi.mock('@/hooks/useRecordingStart', () => ({
  useRecordingStart: (...args: unknown[]) => {
    useRecordingStartMock(...args);
    return { handleRecordingStart: handleRecordingStartMock };
  },
}));

let isRecordingValue = false;
vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({ isRecording: isRecordingValue }),
}));

// Gate de registro (#66): por defecto completado para que los tests del #65
// sigan ejercitando el camino feliz.
let registrationValue: boolean | null = true;
vi.mock('@/hooks/useRegistrationGate', () => ({
  useRegistrationGate: () => ({ registrationFormCompleted: registrationValue }),
}));

const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

// Devuelve un objeto NUEVO en cada render, como el ConfigContext real: es
// justamente lo que hacía que el dep array cambiara sin parar.
vi.mock('@/contexts/ConfigContext', () => ({
  useConfig: () => ({
    selectedDevices: { micDevice: null, systemDevice: null },
    updateSelectedDevices: vi.fn(),
  }),
}));

import { RecordingWidgetListener } from './RecordingWidgetListener';

describe('RecordingWidgetListener — suscripción (issue #65)', () => {
  beforeEach(() => {
    listenMock.mockReset();
    useRecordingStartMock.mockReset();
    handleRecordingStartMock.mockReset();
    isRecordingValue = false;
    registrationValue = true;
    toastErrorMock.mockReset();
    listenMock.mockImplementation(async () => () => undefined);
  });

  it('se suscribe UNA sola vez aunque el padre re-renderice muchas veces', async () => {
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)} data-testid="rerender">
            tick {tick}
          </button>
          <RecordingWidgetListener />
        </>
      );
    }

    const { getByTestId, rerender } = render(<Parent />);
    await new Promise((r) => setTimeout(r, 0));

    for (let i = 0; i < 10; i++) {
      getByTestId('rerender').click();
      rerender(<Parent />);
    }
    await new Promise((r) => setTimeout(r, 0));

    // Antes del arreglo esto era 11+ (una por render). Ahora exactamente 1.
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0][0]).toBe('widget-request-start-recording');

    cleanup();
  });

  it('pasa a useRecordingStart un callback ESTABLE entre renders', async () => {
    // La raíz del bug: un arrow inline aquí rompe la memoización de
    // handleRecordingStart aguas abajo. Debe ser la misma referencia siempre.
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)} data-testid="rerender">
            tick {tick}
          </button>
          <RecordingWidgetListener />
        </>
      );
    }

    const { getByTestId, rerender } = render(<Parent />);
    getByTestId('rerender').click();
    rerender(<Parent />);
    await new Promise((r) => setTimeout(r, 0));

    expect(useRecordingStartMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const setIsRecordingArgs = useRecordingStartMock.mock.calls.map((c) => c[1]);
    const first = setIsRecordingArgs[0];
    expect(setIsRecordingArgs.every((fn) => fn === first)).toBe(true);

    cleanup();
  });

  it('libera el listener al desmontar, y un segundo cleanup no truena', async () => {
    const unsub = vi.fn();
    listenMock.mockImplementation(async () => unsub);

    const { unmount } = render(<RecordingWidgetListener />);
    await new Promise((r) => setTimeout(r, 0));

    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);

    // Un unlisten repetido es lo que producía el TypeError en Tauri.
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe('RecordingWidgetListener — gate de registro (issue #66)', () => {
  beforeEach(() => {
    listenMock.mockReset();
    useRecordingStartMock.mockReset();
    handleRecordingStartMock.mockReset();
    toastErrorMock.mockReset();
    isRecordingValue = false;
    listenMock.mockImplementation(async () => () => undefined);
  });

  async function fireWidgetStart(payload: unknown = null) {
    await new Promise((r) => setTimeout(r, 0));
    const handler = listenMock.mock.calls[0][1] as (e: { payload: unknown }) => void;
    handler({ payload });
  }

  it('con registro completado dispara handleRecordingStart', async () => {
    registrationValue = true;
    render(<RecordingWidgetListener />);
    await fireWidgetStart();
    expect(handleRecordingStartMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
    cleanup();
  });

  it.each([false, null])(
    'con registro = %s NO arranca y avisa con toast (fail-closed)',
    async (value) => {
      registrationValue = value;
      render(<RecordingWidgetListener />);
      await fireWidgetStart();
      expect(handleRecordingStartMock).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/registro/i);
      cleanup();
    },
  );

  it('lee el valor FRESCO del gate (latest-ref) sin resuscribirse', async () => {
    registrationValue = false;
    const { rerender } = render(<RecordingWidgetListener />);
    await fireWidgetStart();
    expect(handleRecordingStartMock).not.toHaveBeenCalled();

    // El usuario completa el registro → la query cambia → el componente
    // re-renderiza con true; el mismo listener debe dejar pasar.
    registrationValue = true;
    rerender(<RecordingWidgetListener />);
    await fireWidgetStart();
    expect(handleRecordingStartMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
