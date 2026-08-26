'use client'

import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { AuthService } from '@/shared/maity-shared/domain/auth/auth.service'
import type { UserStatus } from '@/shared/maity-shared/domain/auth/auth.types'
import { logger } from '@/lib/logger'

/**
 * Resultado del gate: `registration_form_completed` es SIEMPRE booleano — si
 * no se pudo determinar, la query queda en error (nunca "null = pasa").
 * `fromCache` marca que la RPC falló y el valor salió de la caché monótona de
 * Rust (`get_registration_status`), sembrada por `set_current_user` (#66).
 */
export interface RegistrationGateStatus {
  registration_form_completed: boolean
  fromCache: boolean
  status: UserStatus | null
}

/**
 * queryFn del gate. Exportada para testearla sin montar react-query.
 *
 * Flujo:
 * 1. RPC `my_status` → sincroniza a Rust con `set_registration_status`
 *    (Rust es la autoridad del gate de grabación: embudo, scheduler, tray).
 * 2. Si la RPC falla (arranque sin red, 403, timeout) → `get_registration_status`;
 *    solo un `true` cacheado deja pasar. Cualquier otra cosa re-lanza el error
 *    y el layout muestra "No pudimos verificar tu cuenta" con Reintentar.
 *
 * Un `my_status` vacío también es error: `AuthGate` ya esperó a `maityUser`,
 * así que la fila existe; vacío = anomalía, no "usuario nuevo".
 */
export async function fetchRegistrationGateStatus(): Promise<RegistrationGateStatus> {
  try {
    const statuses = await AuthService.getMyStatus()
    const status = statuses[0] ?? null
    if (!status) {
      throw new Error('my_status devolvió vacío')
    }
    const completed = status.registration_form_completed === true
    // Fire-and-forget: la caché/estado nativo es best-effort para el gate de
    // render; el gate de Rust se alimenta de aquí y, si esto falla, bloquea
    // (fail-closed), que es el lado seguro.
    invoke('set_registration_status', { userId: status.id, completed }).catch((err) => {
      logger.warn('[registration-gate] set_registration_status falló:', err)
    })
    return { registration_form_completed: completed, fromCache: false, status }
  } catch (err) {
    const cached = await invoke<boolean | null>('get_registration_status').catch(() => null)
    if (cached === true) {
      logger.warn('[registration-gate] my_status falló; se usa la caché local (registro completado):', err)
      return { registration_form_completed: true, fromCache: true, status: null }
    }
    throw err
  }
}

/**
 * Verifica el estado de registro del usuario vía RPC `my_status`.
 *
 * FAIL-CLOSED (#66): `registrationFormCompleted` es `true`, `false` o `null`
 * (= desconocido: cargando o error). El consumidor (`layout.tsx`) solo deja
 * pasar con `=== true`; `null` con `isError` pinta la pantalla de reintento.
 * Antes `null` caía al main app y un usuario sin red o con la RPC en 403
 * usaba la app (y grababa) sin registrarse.
 */
export function useRegistrationGate() {
  const query = useQuery({
    queryKey: ['user', 'status'],
    queryFn: fetchRegistrationGateStatus,
    staleTime: 60 * 1000,
    retry: 2,
  })

  return {
    /** Sin dato todavía y sin error (status 'pending'). */
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    /** null = desconocido (cargando o error); true/false = determinado */
    registrationFormCompleted: query.data?.registration_form_completed ?? null,
    /** El valor vino de la caché local porque la RPC falló. */
    fromCache: query.data?.fromCache ?? false,
    invalidate: () => query.refetch(),
    refetch: () => query.refetch(),
  }
}
