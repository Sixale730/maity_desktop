import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
let registeredHandler: CloseHandler | null = null;

const closeMock = vi.fn();
const onCloseRequestedMock = vi.fn(async (handler: CloseHandler) => {
  registeredHandler = handler;
  return () => { registeredHandler = null; };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (h: CloseHandler) => onCloseRequestedMock(h),
    close: () => closeMock(),
  }),
}));

import { useWindowCloseGuard } from './useWindowCloseGuard';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useWindowCloseGuard', () => {
  beforeEach(() => {
    registeredHandler = null;
    closeMock.mockReset();
    onCloseRequestedMock.mockClear();
  });

  // Regresion sep-2026: sin preventDefault, @tauri-apps/api llama destroy() y,
  // con core:window:allow-destroy concedido (8bdd3bf), la app sale entera al
  // pulsar la X. El hide a la bandeja lo hace Rust; JS SIEMPRE previene.
  it('previene close SIEMPRE, sin confirm ni close() cuando no hay grabacion', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderHook(() => useWindowCloseGuard(false));
    await flush();

    expect(registeredHandler).not.toBeNull();

    const event = { preventDefault: vi.fn() };
    await registeredHandler!(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('la segunda vuelta tras confirmar (close() re-entrante) no vuelve a preguntar', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderHook(() => useWindowCloseGuard(true));
    await flush();

    const first = { preventDefault: vi.fn() };
    await registeredHandler!(first);
    expect(closeMock).toHaveBeenCalledTimes(1);

    // Rust vuelve a emitir CloseRequested por el close() forzado.
    const second = { preventDefault: vi.fn() };
    await registeredHandler!(second);

    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('previene close + pide confirmacion cuando esta grabando', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderHook(() => useWindowCloseGuard(true));
    await flush();

    const event = { preventDefault: vi.fn() };
    await registeredHandler!(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('llama close() cuando el usuario confirma con grabacion activa', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderHook(() => useWindowCloseGuard(true));
    await flush();

    const event = { preventDefault: vi.fn() };
    await registeredHandler!(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });
});
