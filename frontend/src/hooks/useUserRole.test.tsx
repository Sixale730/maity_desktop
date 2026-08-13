/**
 * Regresión del issue #68.
 *
 * `useUserRole` hacía `rpcRole ?? getUserRoleFromEmail(email)`, así que
 * CUALQUIER fallo de `get_user_role` — error de RPC, sin red, excepción, fila
 * ausente, valor no reconocido — concedía UI de admin a `@asertio.mx` y
 * `@maity.cloud`, y degradaba en silencio a todos los demás. Sin estado de
 * error: `loading` pasaba a false y el rol simplemente quedaba mal.
 *
 * No era teórico: #70 dejó esa misma RPC en 403 desde el 13-ago 05:00 UTC, o
 * sea que el fallback fue el camino PRINCIPAL de todo el desktop.
 *
 * El invariante que protegen estos tests es fail-closed: si no sabemos el rol,
 * NO hay admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getUserRoleFromRPCMock = vi.fn();
let authValue: { user: { email: string } | null; maityUser: { email: string } | null } = {
  user: null,
  maityUser: null,
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authValue,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

vi.mock('@/lib/roles', () => ({
  getUserRoleFromRPC: (...args: unknown[]) => getUserRoleFromRPCMock(...args),
}));

import { useUserRole } from './useUserRole';

describe('useUserRole (issue #68)', () => {
  beforeEach(() => {
    vi.resetModules();
    getUserRoleFromRPCMock.mockReset();
    authValue = { user: { email: 'alice@asertio.mx' }, maityUser: null };
  });

  it('un correo de dominio interno NO da admin si la RPC falla', async () => {
    // ESTE es el bug. Antes: rpcRole=null -> getUserRoleFromEmail('@asertio.mx')
    // -> 'admin'. Ahora el rol queda desconocido y isAdmin es false.
    getUserRoleFromRPCMock.mockResolvedValue(null);

    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.role).toBeNull();
    expect(result.current.roleKnown).toBe(false);
  });

  it('"desconocido" no se confunde con "es user"', async () => {
    getUserRoleFromRPCMock.mockResolvedValue(null);

    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Distinguirlos es lo que le permite a ConfigContext NO pisar la config
    // persistida de un admin mientras el rol sigue en el aire.
    expect(result.current.isUser).toBe(false);
    expect(result.current.roleKnown).toBe(false);
  });

  it('isAdmin es false mientras la RPC está en vuelo', async () => {
    let resolveRpc: ((r: string | null) => void) | null = null;
    getUserRoleFromRPCMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );

    const { result } = renderHook(() => useUserRole());

    // Render inicial: antes ya devolvia 'admin' por correo y la UI de admin
    // parpadeaba antes de que contestara la RPC.
    expect(result.current.loading).toBe(true);
    expect(result.current.isAdmin).toBe(false);

    resolveRpc!('admin');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
  });

  it('respeta el rol real de la DB para un dominio externo', async () => {
    // En produccion hay 2 admins y 4 managers de dominio externo: el heuristico
    // por correo los degradaba a 'user'.
    authValue = { user: { email: 'carlos@clienteexterno.com' }, maityUser: null };
    getUserRoleFromRPCMock.mockResolvedValue('manager');

    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe('manager');
    expect(result.current.isManager).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.roleKnown).toBe(true);
  });

  it("una cuenta interna que NO es admin en la DB no recibe admin", async () => {
    // Caso real: 2 cuentas @asertio.mx/@maity.cloud tienen rol 'user'.
    authValue = { user: { email: 'becario@maity.cloud' }, maityUser: null };
    getUserRoleFromRPCMock.mockResolvedValue('user');

    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isUser).toBe(true);
  });

  it('colapsa las llamadas concurrentes en una sola RPC', async () => {
    getUserRoleFromRPCMock.mockResolvedValue('user');

    const a = renderHook(() => useUserRole());
    const b = renderHook(() => useUserRole());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    // Tres consumidores desde #68 (settings, TranscriptSettings, ConfigContext);
    // sin el dedupe serian tres round-trips en cada arranque.
    expect(getUserRoleFromRPCMock).toHaveBeenCalledTimes(1);
  });
});
