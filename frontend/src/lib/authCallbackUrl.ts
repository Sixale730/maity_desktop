/**
 * Parsers puros de las URLs de deep link de autenticación que recibe el desktop:
 *
 *   maity://auth/callback?code=…                       ← OAuth social, flujo PKCE (el actual:
 *                                                        `flowType: 'pkce'` en lib/supabase.ts)
 *   maity://auth/callback?error=…&error_description=…  ← el provider rechazó / el usuario canceló
 *   maity://auth/callback#access_token=…&refresh_token=… ← flujo implícito (legacy) y la rama de
 *                                                        Rust `get_pending_auth_tokens`
 *   maity://auth/confirm?token_hash=…&type=signup      ← verificación de email
 *
 * Viven fuera de AuthContext porque ahí no son testeables como unidad. No usan `new URL()`:
 * los esquemas custom no garantizan parseo de `searchParams`/`hash` en todos los webviews.
 */

/** Query params de una URL de deep link (lo que hay entre `?` y `#`, o hasta el final). */
export function extractQueryParams(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?')
  if (queryIndex === -1) return new URLSearchParams()
  const hashIndex = url.indexOf('#')
  const end = hashIndex > queryIndex ? hashIndex : url.length
  return new URLSearchParams(url.substring(queryIndex + 1, end))
}

/**
 * `access_token` + `refresh_token` del fragment (flujo implícito).
 * Devuelve `null` si falta cualquiera de los dos.
 */
export function extractTokensFromUrl(url: string): { accessToken: string; refreshToken: string } | null {
  try {
    const hashIndex = url.indexOf('#')
    if (hashIndex === -1) return null

    const params = new URLSearchParams(url.substring(hashIndex + 1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken }
    }
    return null
  } catch {
    return null
  }
}

/** `code` PKCE del query (`maity://auth/callback?code=…`). `null` si no viene o está vacío. */
export function extractAuthCode(url: string): string | null {
  try {
    const code = extractQueryParams(url).get('code')
    return code ? code : null
  } catch {
    return null
  }
}

/**
 * Error que Supabase/el provider devuelven en el query del redirect
 * (`?error=access_denied&error_description=…`). `null` si no hay `error`.
 */
export function extractAuthError(url: string): { error: string; description: string | null } | null {
  try {
    const params = extractQueryParams(url)
    const error = params.get('error')
    if (!error) return null
    const description = params.get('error_description')
    return { error, description: description ? description : null }
  } catch {
    return null
  }
}
