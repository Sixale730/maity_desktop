/**
 * Decisión pura de cuándo el webview suelta al usuario en Rust (#83, AC-18).
 *
 * Rust sobrevive a una recarga del webview (F5, ChunkErrorRecovery, ErrorBoundary,
 * HMR), pero el webview monta de nuevo con `maityUser = null` mientras `getSession`
 * restaura la sesión. El efecto de `AuthContext` llamaba `clear_current_user` +
 * `cloud_sync_clear_session` en ESE primer render: Rust quedaba sin
 * `current_user_id`, la jornada veía `has_session == false`, el STT se descargaba y
 * un segmento que se cerrara en el hueco terminaba `Failed` ("sin usuario logueado").
 *
 * Sin imports de React, Tauri ni supabase: lo prueba `authRelease.test.ts`.
 */

/**
 * ¿Debe el webview soltar al usuario en Rust (clear_current_user + cloud_sync_clear_session)?
 * - nextId presente: nunca (hay usuario; el efecto hace set_current_user).
 * - prevId presente y nextId ausente: sí (transición real Some→None: logout o sesión perdida).
 * - ninguno de los dos: solo si la inicialización de auth YA terminó (authReady) — durante la
 *   carga inicial del montaje (recarga del webview) Rust conserva al usuario de antes.
 *   `authReady` también es `false` cuando el arranque quedó INCIERTO (sin sesión por red
 *   caída: ver `isBootSessionUncertain`), así que ese caso tampoco suelta.
 */
export function shouldReleaseRustUser(
  prevId: string | null,
  nextId: string | null,
  authReady: boolean,
): boolean {
  if (nextId) return false
  if (prevId) return true
  return authReady
}

/**
 * ¿El arranque sin sesión es incierto (no se puede afirmar que no hay usuario)?
 *
 * auth-js devuelve `session: null` ante CUALQUIER error de refresh, incluido red, pero
 * solo borra la sesión guardada en errores no reintentables. Un arranque offline con el
 * token vencido NO es "sin usuario": la misma cuenta vuelve en cuanto hay red.
 *
 * @param hasSession      `getSession` devolvió sesión.
 * @param retryableError  el error de `getSession` es reintentable (`isAuthRetryableFetchError`).
 * @param online          `navigator.onLine` (false ⇒ sin red segura).
 */
export function isBootSessionUncertain(
  hasSession: boolean,
  retryableError: boolean,
  online: boolean,
): boolean {
  if (hasSession) return false
  return retryableError || !online
}
