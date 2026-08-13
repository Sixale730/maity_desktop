import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { type UserRole, getUserRoleFromRPC } from '@/lib/roles';

/**
 * Dedupe de la RPC in-flight, llaveado por email.
 *
 * Cada consumidor monta su propio efecto, asi que sin esto una pantalla con dos
 * consumidores dispara dos `get_user_role`. Desde #68 hay tres (settings,
 * TranscriptSettings y ConfigContext). Se invalida al cambiar de cuenta; no
 * cachea el RESULTADO, solo colapsa las llamadas concurrentes, para que un
 * fallo transitorio no quede pegado toda la sesion.
 */
let inFlight: { key: string; promise: Promise<UserRole | null> } | null = null;

function fetchRoleDeduped(email: string | null): Promise<UserRole | null> {
  const key = email ?? '<sin-email>';
  if (inFlight && inFlight.key === key) return inFlight.promise;

  const promise = getUserRoleFromRPC(supabase).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}

export interface UseUserRoleResult {
  /** `null` = DESCONOCIDO (RPC en vuelo o fallida). Nunca asumir 'user'. */
  role: UserRole | null;
  /** `false` mientras carga o si la RPC fallo. */
  roleKnown: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isUser: boolean;
  loading: boolean;
}

/**
 * Rol del usuario, resuelto SIEMPRE contra la DB (issue #68).
 *
 * **Fail-closed**: `isAdmin` es `false` mientras carga Y si la RPC falla. Antes
 * el hook hacia `rpcRole ?? getUserRoleFromEmail(email)`, asi que un fallo
 * transitorio CONCEDIA UI de admin a `@asertio.mx`/`@maity.cloud` y degradaba a
 * todos los demas — sin estado de error: `loading` pasaba a false y el rol
 * simplemente quedaba mal.
 *
 * El intercambio es deliberado: ahora un fallo esconde UI de admin en vez de
 * regalarla. Con 5 admins reales en toda la base y la pantalla recuperable
 * reabriendo Ajustes, es el lado correcto para equivocarse. `role` es
 * `UserRole | null` justamente para que "desconocido" no se pueda confundir con
 * "es user"; quien necesite distinguirlos tiene `roleKnown`.
 *
 * Ojo: esto gobierna VISIBILIDAD de UI, no acceso a datos — del lado servidor
 * manda RLS.
 */
export function useUserRole(): UseUserRoleResult {
  const { user, maityUser } = useAuth();
  const email = user?.email ?? maityUser?.email ?? null;

  const [rpcRole, setRpcRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    void fetchRoleDeduped(email).then((role) => {
      if (cancelled) return;
      setRpcRole(role);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [email]);

  return useMemo(() => {
    return {
      role: rpcRole,
      roleKnown: rpcRole !== null,
      // Sin `?? getUserRoleFromEmail(...)`: ese era exactamente el bug de #68.
      isAdmin: rpcRole === 'admin',
      isManager: rpcRole === 'manager',
      isUser: rpcRole === 'user',
      loading,
    };
  }, [rpcRole, loading]);
}
