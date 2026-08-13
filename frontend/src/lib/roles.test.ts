import { describe, it, expect, vi } from 'vitest';
import {
  ADMIN_DOMAINS,
  getUserRoleFromEmail,
  getUserRoleFromRPC,
  isAdmin,
  isManager,
} from './roles';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('roles', () => {
  describe('ADMIN_DOMAINS', () => {
    it('contiene los dominios internos conocidos', () => {
      expect(ADMIN_DOMAINS).toEqual(expect.arrayContaining(['asertio.mx', 'maity.cloud']));
    });
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

  describe('getUserRoleFromEmail', () => {
    it('retorna "user" para null/undefined/empty', () => {
      expect(getUserRoleFromEmail(null)).toBe('user');
      expect(getUserRoleFromEmail(undefined)).toBe('user');
      expect(getUserRoleFromEmail('')).toBe('user');
    });

    it('retorna "admin" para dominios internos', () => {
      expect(getUserRoleFromEmail('alice@asertio.mx')).toBe('admin');
      expect(getUserRoleFromEmail('bob@maity.cloud')).toBe('admin');
    });

    it('es case-insensitive en el dominio', () => {
      expect(getUserRoleFromEmail('ALICE@ASERTIO.MX')).toBe('admin');
      expect(getUserRoleFromEmail('Bob@Maity.Cloud')).toBe('admin');
    });

    it('retorna "user" para dominios externos', () => {
      expect(getUserRoleFromEmail('charlie@gmail.com')).toBe('user');
      expect(getUserRoleFromEmail('dave@asertio.com')).toBe('user');
    });

    it('retorna "user" si el email no tiene @', () => {
      expect(getUserRoleFromEmail('notanemail')).toBe('user');
    });
  });

  describe('getUserRoleFromRPC', () => {
    // El stub replica el ruteo por schema de supabase-js: `.schema(x)` devuelve
    // una superficie nueva. Antes solo tenia `.rpc`, asi que un `.schema()` en
    // el codigo tronaba adentro del try/catch y devolvia null en silencio — el
    // mismo modo de falla del issue #70. `lastSchema` lo hace observable.
    let lastSchema: string | undefined;
    const makeSupabase = (rpcResult: { data: unknown; error: Error | null }) => {
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
    });

    it('retorna el rol cuando la RPC devuelve "manager"', async () => {
      const supabase = makeSupabase({ data: 'manager', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBe('manager');
    });

    it('normaliza mayúsculas a minúsculas', async () => {
      const supabase = makeSupabase({ data: 'ADMIN', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBe('admin');
    });

    it('retorna null si data es null', async () => {
      const supabase = makeSupabase({ data: null, error: null });
      expect(await getUserRoleFromRPC(supabase)).toBeNull();
    });

    it('retorna null si hay error', async () => {
      const supabase = makeSupabase({ data: null, error: new Error('boom') });
      expect(await getUserRoleFromRPC(supabase)).toBeNull();
    });

    it('retorna null para valores desconocidos', async () => {
      const supabase = makeSupabase({ data: 'superuser', error: null });
      expect(await getUserRoleFromRPC(supabase)).toBeNull();
    });

    it('retorna null si la RPC lanza excepción', async () => {
      const supabase = {
        rpc: vi.fn(async () => {
          throw new Error('network');
        }),
      } as unknown as SupabaseClient;
      expect(await getUserRoleFromRPC(supabase)).toBeNull();
    });
  });
});
