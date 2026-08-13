import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const warnMock = vi.fn();
vi.mock('@/lib/fileLogger', () => ({
  fileLogger: {
    warn: (...args: unknown[]) => warnMock(...args),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { getUserRoleFromRPC, isAdmin, isManager } from './roles';

describe('roles', () => {
  beforeEach(() => {
    warnMock.mockReset();
  });

  describe('isAdmin / isManager', () => {
    it('isAdmin identifica solo "admin"', () => {
      expect(isAdmin('admin')).toBe(true);
      expect(isAdmin('manager')).toBe(false);
      expect(isAdmin('user')).toBe(false);
    });

    it('isManager identifica solo "manager"', () => {
      expect(isManager('manager')).toBe(true);
      expect(isManager('admin')).toBe(false);
      expect(isManager('user')).toBe(false);
    });
  });

  describe('sin heuristico por dominio de correo (issue #68)', () => {
    it('el modulo ya NO exporta ADMIN_DOMAINS ni getUserRoleFromEmail', async () => {
      // Contrastado contra produccion, ese heuristico estaba mal para 8 de 249
      // usuarios: degradaba a 2 admins y 4 managers de dominio externo, y le
      // regalaba admin a 2 cuentas internas que no lo son. Reintroducirlo —
      // aunque sea "solo para un caso"— es la regresion que este test bloquea.
      const mod = await import('./roles');
      expect(mod).not.toHaveProperty('ADMIN_DOMAINS');
      expect(mod).not.toHaveProperty('getUserRoleFromEmail');
    });
  });

  describe('getUserRoleFromRPC', () => {
    // El stub replica el ruteo por schema de supabase-js: `.schema(x)` devuelve
    // una superficie nueva. Antes solo tenia `.rpc`, asi que un `.schema()` en
    // el codigo tronaba adentro del try/catch y devolvia null en silencio — el
    // mismo modo de falla del issue #70. `lastSchema` lo hace observable.
    let lastSchema: string | undefined;
    const makeSupabase = (rpcResult: { data: unknown; error: unknown }) => {
      lastSchema = undefined;
      const rpc = vi.fn(async () => rpcResult);
      return {
        rpc,
        schema: vi.fn((name: string) => {
          lastSchema = name;
          return { rpc };
        }),
      } as unknown as SupabaseClient;
    };

    it("get_user_role se pide contra el schema 'public'", async () => {
      // El gate de autorizacion vive en el wrapper public.get_user_role; la
      // version maity.* no esta concedida a `authenticated` (issue web #143).
      const supabase = makeSupabase({ data: 'admin', error: null });
      await getUserRoleFromRPC(supabase);
      expect(lastSchema).toBe('public');
    });

    it('retorna el rol cuando la RPC devuelve "admin"', async () => {
      const supabase = makeSupabase({ data: 'admin', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBe('admin');
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('retorna el rol cuando la RPC devuelve "manager"', async () => {
      const supabase = makeSupabase({ data: 'manager', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBe('manager');
    });

    it('normaliza mayúsculas a minúsculas', async () => {
      const supabase = makeSupabase({ data: 'ADMIN', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBe('admin');
    });

    // Las cuatro ramas de fallo devuelven null Y DEJAN RASTRO. Antes colapsaban
    // todas a `null` sin loguear nada, y por eso #70 vivio meses en produccion
    // sin una sola señal.
    const failureCases: Array<[string, { data: unknown; error: unknown }, string]> = [
      ['data es null', { data: null, error: null }, 'no-role'],
      ['hay error', { data: null, error: { code: '42501', message: 'denied' } }, 'rpc-error'],
      ['valor desconocido', { data: 'superuser', error: null }, 'unrecognized'],
    ];

    for (const [nombre, resultado, reason] of failureCases) {
      it(`retorna null y loguea reason='${reason}' si ${nombre}`, async () => {
        const supabase = makeSupabase(resultado);
        expect(await getUserRoleFromRPC(supabase)).toBeNull();
        expect(warnMock).toHaveBeenCalledTimes(1);
        expect(warnMock.mock.calls[0][2]).toMatchObject({ reason });
      });
    }

    it("retorna null y loguea reason='exception' si la RPC lanza", async () => {
      const supabase = {
        schema: vi.fn(() => ({
          rpc: vi.fn(async () => {
            throw new Error('network');
          }),
        })),
      } as unknown as SupabaseClient;

      expect(await getUserRoleFromRPC(supabase)).toBeNull();
      expect(warnMock.mock.calls[0][2]).toMatchObject({ reason: 'exception' });
    });
  });
});
