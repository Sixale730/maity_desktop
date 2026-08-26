/**
 * Gate de registro fail-closed (#66).
 *
 * Invariantes: (1) la RPC `my_status` sincroniza su valor a Rust
 * (`set_registration_status`, autoridad del gate de grabación); (2) si la RPC
 * falla solo un `true` cacheado en Rust deja pasar; (3) cualquier otro fallo
 * (RPC caída sin caché, respuesta vacía) deja el gate en error — nunca en
 * "null = pasa", que era el bug original.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const getMyStatusMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@/shared/maity-shared/domain/auth/auth.service', () => ({
  AuthService: { getMyStatus: (...args: unknown[]) => getMyStatusMock(...args) },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { fetchRegistrationGateStatus, useRegistrationGate } from './useRegistrationGate';

function status(overrides: Record<string, unknown> = {}) {
  return { id: 'u-1', registration_form_completed: true, ...overrides };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = 'TestQueryClientProviderWrapper';
  return Wrapper;
}

describe('fetchRegistrationGateStatus', () => {
  beforeEach(() => {
    getMyStatusMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('RPC true → completado y sincroniza set_registration_status(userId, true)', async () => {
    getMyStatusMock.mockResolvedValue([status()]);
    const result = await fetchRegistrationGateStatus();
    expect(result).toMatchObject({ registration_form_completed: true, fromCache: false });
    expect(invokeMock).toHaveBeenCalledWith('set_registration_status', { userId: 'u-1', completed: true });
  });

  it('RPC false → no completado y sincroniza false (única fuente de Some(false) en Rust)', async () => {
    getMyStatusMock.mockResolvedValue([status({ registration_form_completed: false })]);
    const result = await fetchRegistrationGateStatus();
    expect(result.registration_form_completed).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith('set_registration_status', { userId: 'u-1', completed: false });
  });

  it('RPC caída + caché true en Rust → pasa marcado fromCache', async () => {
    getMyStatusMock.mockRejectedValue(new Error('network down'));
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_registration_status' ? true : undefined,
    );
    const result = await fetchRegistrationGateStatus();
    expect(result).toEqual({ registration_form_completed: true, fromCache: true, status: null });
    expect(invokeMock).not.toHaveBeenCalledWith('set_registration_status', expect.anything());
  });

  it('RPC caída sin caché → re-lanza (fail-closed, nunca "null = pasa")', async () => {
    getMyStatusMock.mockRejectedValue(new Error('network down'));
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_registration_status' ? null : undefined,
    );
    await expect(fetchRegistrationGateStatus()).rejects.toThrow('network down');
  });

  it('RPC caída y el propio invoke falla → sigue siendo error, no pasa', async () => {
    getMyStatusMock.mockRejectedValue(new Error('network down'));
    invokeMock.mockRejectedValue(new Error('ipc broken'));
    await expect(fetchRegistrationGateStatus()).rejects.toThrow('network down');
  });

  it('my_status vacío → error (AuthGate ya garantizó la fila: vacío es anomalía)', async () => {
    getMyStatusMock.mockResolvedValue([]);
    invokeMock.mockResolvedValue(null);
    await expect(fetchRegistrationGateStatus()).rejects.toThrow(/vacío/);
  });

  it('un fallo al sincronizar a Rust no rompe el gate de render', async () => {
    getMyStatusMock.mockResolvedValue([status()]);
    invokeMock.mockRejectedValue(new Error('ipc broken'));
    const result = await fetchRegistrationGateStatus();
    expect(result.registration_form_completed).toBe(true);
  });
});

describe('useRegistrationGate', () => {
  beforeEach(() => {
    getMyStatusMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('expone true/false determinado y null mientras carga', async () => {
    getMyStatusMock.mockResolvedValue([status({ registration_form_completed: false })]);
    const { result } = renderHook(() => useRegistrationGate(), { wrapper: makeWrapper() });
    expect(result.current.registrationFormCompleted).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.registrationFormCompleted).toBe(false));
    expect(result.current.isError).toBe(false);
  });

  it('con la RPC caída y sin caché queda en error con null (no true)', async () => {
    getMyStatusMock.mockRejectedValue(new Error('network down'));
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => useRegistrationGate(), { wrapper: makeWrapper() });
    // El hook fija `retry: 2` (pisa el default del QueryClient de test): con el
    // backoff de react-query (1 s + 2 s) el error tarda ~3 s en asentarse.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 8000 });
    expect(result.current.registrationFormCompleted).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
