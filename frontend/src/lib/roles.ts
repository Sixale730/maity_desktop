import type { SupabaseClient } from '@supabase/supabase-js';
import { fileLogger } from '@/lib/fileLogger';

export type UserRole = 'admin' | 'manager' | 'user';

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export function isManager(role: UserRole): boolean {
  return role === 'manager';
}

/** Por que fallo la RPC. Se loguea; no se expone al consumidor. */
type FailureReason = 'rpc-error' | 'no-role' | 'unrecognized' | 'exception';

/**
 * Fuente unica de verdad del rol: la RPC `public.get_user_role`.
 *
 * `null` significa **DESCONOCIDO**, nunca "es user" (issue #68). El consumidor
 * debe fallar cerrado — ver `useUserRole`.
 *
 * ## Por que ya no hay fallback por dominio de correo
 *
 * Hasta ago-2026 existian `ADMIN_DOMAINS = ['asertio.mx','maity.cloud']` y
 * `getUserRoleFromEmail()`, y `useUserRole` hacia `rpcRole ?? getUserRoleFromEmail(email)`.
 * O sea que CUALQUIER fallo de esta RPC repartia UI de admin a los dominios
 * internos y degradaba en silencio a todos los demas. No era teorico: #70 dejo
 * esta misma RPC en 403 desde el 13-ago 05:00 UTC, asi que el fallback fue el
 * camino PRINCIPAL de todo el desktop, no la excepcion.
 *
 * Se elimino entero, no solo "invertido a user", porque contrastado contra
 * produccion el heuristico esta mal para 8 de 249 usuarios HOY: 2 admins y 4
 * managers de dominio externo (los degradaba a user) y 2 cuentas internas que
 * NO son admin (les regalaba admin). La DB tiene roles reales desde el 12-ago
 * y el trigger `maity_users_ensure_role` le pone 'user' a toda alta nueva, asi
 * que un NULL aqui ya es una anomalia de verdad, no el caso normal.
 *
 * ## Por que fileLogger y no platformLogger
 *
 * `platformLogger.log` es el mismo una RPC de Supabase: si `get_user_role`
 * falla por sesion/RLS/403, `insert_platform_log` falla por lo mismo y la senal
 * se pierde justo cuando importa. `fileLogger` escribe al archivo local que
 * viaja en el ZIP de soporte. Las cuatro ramas de fallo se loguean: antes las
 * cuatro colapsaban a `null` sin dejar rastro, y por eso #70 vivio meses.
 */
export async function getUserRoleFromRPC(supabase: SupabaseClient): Promise<UserRole | null> {
  const fail = (reason: FailureReason, detail?: unknown): null => {
    void fileLogger.warn('roles', 'get_user_role fallo', { reason, detail });
    return null;
  };

  try {
    const { data, error } = await supabase.schema('public').rpc('get_user_role');
    if (error) return fail('rpc-error', { code: error.code, message: error.message });
    if (!data) return fail('no-role');

    const role = String(data).toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'user') {
      return role;
    }
    return fail('unrecognized', { value: role });
  } catch (err) {
    return fail('exception', err instanceof Error ? err.message : String(err));
  }
}
