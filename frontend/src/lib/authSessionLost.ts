/**
 * Decisión pura de cuándo reportar `auth.session_lost` (#83, AC-19).
 *
 * Solo pérdidas REALES de sesión, nunca por red caída:
 * - `webview_signed_out`: SIGNED_OUT espontáneo de supabase-js mientras la app corre
 *   (refresh rechazado, sesión revocada) y SIN un logout del usuario en curso.
 * - `boot_no_session`: arranque sin sesión cuyo `getSession` NO falló por red. Rust
 *   decide además con la marca de último login (sin marca no emite).
 *
 * El caso típico a NO reportar: autostart antes de que suba el Wi-Fi con el token
 * vencido — auth-js devuelve `session: null` con un error reintentable. Un falso
 * positivo cada mañana además consumiría la marca y taparía una pérdida real.
 *
 * Sin React ni Tauri: lo prueba `authSessionLost.test.ts`.
 */
import { isAuthRetryableFetchError } from '@supabase/supabase-js'

export type SessionLostSource = 'webview_signed_out' | 'boot_no_session'

/** SIGNED_OUT sin sesión nueva y sin logout en curso ⇒ 'webview_signed_out'; cualquier otro caso ⇒ null. */
export function signedOutSessionLostSource(
  event: string,
  hasNewSession: boolean,
  isSigningOut: boolean,
): 'webview_signed_out' | null {
  if (event !== 'SIGNED_OUT') return null
  if (hasNewSession || isSigningOut) return null
  return 'webview_signed_out'
}

/** Arranque sin sesión: reportar solo si no hay sesión, el error es null o NO reintentable, y online !== false. */
export function shouldReportBootNoSession(
  hasSession: boolean,
  error: unknown,
  online: boolean | undefined,
): boolean {
  if (hasSession) return false
  if (online === false) return false
  if (error != null && isAuthRetryableFetchError(error)) return false
  return true
}

/** error?.name si es string (p. ej. 'AuthApiError', 'AuthSessionMissingError'); si no, null. */
export function authErrorName(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : null
}
