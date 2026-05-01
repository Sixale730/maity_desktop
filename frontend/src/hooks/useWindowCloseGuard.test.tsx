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

  it('NO previene close cuando no hay grabacion activa', async () => {
    renderHook(() => useWindowCloseGuard(false));
    await flush();

    expect(registeredHandler).not.toBeNull();

    const event = { preventDefault: vi.fn() };
    await registeredHandler!(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
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
