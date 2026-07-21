/**
 * Helpers para el flujo de pago del desktop.
 *
 * El desktop NO tiene Stripe directamente. Al elegir Pro, redirige al usuario
 * a maity.cloud/auth/handoff con los tokens de sesión para que la web lo
 * autentique y luego continúe al checkout de Stripe.
 *
 * Referencia: issue Sixale730/maity#133 (implementar /auth/handoff en la web)
 */
import { invoke } from '@tauri-apps/api/core'
import type { Session } from '@supabase/supabase-js'

const MAITY_CLOUD_BASE = 'https://www.maity.cloud'

/**
 * Construye la URL de handoff con los tokens de sesión.
 * next: ruta a la que redirigir DESPUÉS del handoff en la web.
 */
export function buildHandoffUrl(session: Session, next: string): string {
  const base = `${MAITY_CLOUD_BASE}/auth/handoff`
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token ?? '',
    next: encodeURIComponent(next),
  }).toString()
  return `${base}#${hash}`
}

/**
 * Abre una URL en el navegador externo del sistema vía comando Tauri.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url })
}
