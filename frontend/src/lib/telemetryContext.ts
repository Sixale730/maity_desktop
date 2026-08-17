/**
 * Contexto canónico de telemetría (envelope `ctx`).
 *
 * La identidad (install_id persistente, session_id de PROCESO, app_version)
 * vive en Rust (`logging/telemetry/context.rs`) y se obtiene una sola vez por
 * ventana vía el comando `get_telemetry_context` (cache + single-flight, mismo
 * patrón que resolveAppVersion de platformLogger). Al ser comando propio no
 * pasa por el ACL de plugins, así que funciona también en las ventanas
 * auxiliares.
 *
 * `ctx.session_id` es SIEMPRE el id de proceso — el id de grabación
 * (`session-…`) es otro nivel y viaja como `recording_session_id` en el
 * payload. Nunca 'unknown': si el contexto no resuelve (dev en browser sin
 * Tauri), los eventos salen SIN `ctx` — un NULL honesto es analizable, un
 * centinela no.
 */

import { invoke } from '@tauri-apps/api/core'
import { AUX_WINDOW_PATHS } from '@/lib/auxWindows'

export const CTX_SCHEMA_VERSION = 1

export interface TelemetryContext {
  install_id: string
  install_id_regenerated: boolean
  app_version: string
  session_id: string
}

let cached: TelemetryContext | null = null
let inflight: Promise<TelemetryContext | null> | null = null

/** Identidad de proceso desde Rust. Cache + single-flight; un fallo NO se
 *  cachea (se reintenta en la próxima llamada). */
export function getTelemetryContext(): Promise<TelemetryContext | null> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = invoke<TelemetryContext>('get_telemetry_context')
      .then((c) => (cached = c))
      .catch(() => {
        inflight = null
        return null
      })
  }
  return inflight
}

/** Nombre de la ventana para `ctx.window`, derivado de la lista canónica de
 *  rutas auxiliares (lib/auxWindows.ts). */
function windowName(): string {
  if (typeof window === 'undefined') return 'main'
  const pathname = window.location?.pathname ?? ''
  const aux = (AUX_WINDOW_PATHS as readonly string[]).find((p) => pathname === p)
  return aux ? aux.slice(1) : 'main'
}

/**
 * Envelope `ctx` listo para inyectar en `event_data`. `occurred_at` es el
 * event time (≠ `created_at`, que es ingest time — en jornada offline pueden
 * diferir horas). Devuelve null fuera de Tauri: el evento sale sin envelope.
 */
export async function buildCtx(): Promise<Record<string, unknown> | null> {
  const base = await getTelemetryContext()
  if (!base) return null
  const ctx: Record<string, unknown> = {
    install_id: base.install_id,
    app_version: base.app_version,
    session_id: base.session_id,
    emitter: 'webview',
    window: windowName(),
    occurred_at: new Date().toISOString(),
    schema: CTX_SCHEMA_VERSION,
  }
  if (base.install_id_regenerated) ctx.install_id_regenerated = true
  return ctx
}

/** Solo para tests: resetea el cache del módulo. */
export function __resetTelemetryContextForTests(): void {
  cached = null
  inflight = null
}
