/**
 * Telemetría de errores — eventos `app.error` a `maity.platform_logs`.
 *
 * Fuentes: handlers globales de `window` ('error' + 'unhandledrejection', que
 * de facto cubren muchos fallos originados en Rust — los rechazos de `invoke()`
 * llegan como strings), `ErrorBoundary.componentDidCatch`, `DbInitErrorGate`
 * ('db-init') y el puente `rust-error` (los `log::error!` de tareas background
 * de Rust que ningún invoke reporta; ver logging/rust_error_bridge.rs — el lado
 * Rust ya dedupea/capea, este limiter es la segunda barrera). Hookear
 * `logger.error` quedó DESCARTADO (issue #63, cerrado como no-planeado): ruido
 * de errores manejados de rutina, doble conteo con los handlers de window y el
 * vector de bucle más peligroso.
 *
 * Presupuesto por sesión de ventana: máx 20 envíos, dedup por (name+message),
 * mínimo 2s entre envíos, sin cola. Los repetidos solo cuentan local.
 *
 * REGLA ANTI-BUCLE: dentro de este módulo está prohibido `logger.*` y
 * `console.*`; todo el path de envío va en try/catch vacío y `platformLogger`
 * nunca lanza ni rechaza — un fallo del propio envío no re-dispara
 * 'unhandledrejection'. El path rust jamás toca `log_frontend_event`, y el
 * layer Rust excluye el target "frontend" — el bucle está cortado en ambos
 * extremos.
 */
import { listen } from '@tauri-apps/api/event'

import { platformLogger } from '@/lib/platformLogger'
import { TauriEvent } from '@/lib/tauri-events'

export const MAX_ERROR_REPORTS_PER_SESSION = 20
export const MIN_REPORT_GAP_MS = 2_000

export type ErrorSource = 'window' | 'unhandledrejection' | 'error-boundary' | 'db-init' | 'rust'

/** Payload del evento `rust-error` (logging/rust_error_bridge.rs). */
export interface RustErrorPayload {
  target: string
  message: string
  ts_ms: number
}

export function truncateStr(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function buildErrorKey(name: string, message: string): string {
  return `${name}:${truncateStr(message, 120)}`
}

export interface NormalizedError {
  name: string
  message: string
  stack?: string
}

/** Los rechazos de `invoke()` Rust son strings, no `Error` — normalizar todo. */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack,
    }
  }
  if (typeof error === 'string') {
    return { name: 'UnhandledRejection', message: error }
  }
  try {
    return { name: 'UnknownError', message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { name: 'UnknownError', message: String(error) }
  }
}

/**
 * Rate-limit + dedup por sesión. Estado puro, exportado para unit tests.
 * Los excedentes se DESCARTAN sin cola: una tormenta de render-loop no debe
 * convertirse en 20 RPCs en un segundo.
 */
export class ErrorReportLimiter {
  private sent = 0
  private lastSentAt = 0
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly maxPerSession = MAX_ERROR_REPORTS_PER_SESSION,
    private readonly minGapMs = MIN_REPORT_GAP_MS,
  ) {}

  /** true si este error debe ENVIARSE. Siempre cuenta la ocurrencia local. */
  shouldReport(key: string, now = Date.now()): boolean {
    const count = (this.seen.get(key) ?? 0) + 1
    this.seen.set(key, count)
    if (count > 1) return false
    if (this.sent >= this.maxPerSession) return false
    if (this.lastSentAt !== 0 && now - this.lastSentAt < this.minGapMs) return false
    this.sent += 1
    this.lastSentAt = now
    return true
  }

  occurrences(key: string): number {
    return this.seen.get(key) ?? 0
  }
}

const limiter = new ErrorReportLimiter()
const startedAt = Date.now()
let installed = false
let reporting = false
let seq = 0

export function reportCaughtError(
  source: ErrorSource,
  error: unknown,
  extra?: { componentStack?: string; rustTsMs?: number },
): void {
  // Guard síncrono: si construir/enviar el reporte lanza y eso re-entra aquí,
  // cortamos en seco.
  if (reporting) return
  reporting = true
  try {
    const norm = normalizeError(error)
    const key = buildErrorKey(norm.name, norm.message)
    if (!limiter.shouldReport(key)) return

    seq += 1
    const message = truncateStr(norm.message, 500)
    void platformLogger.log(
      'app.error',
      {
        source,
        name: norm.name,
        message,
        stack: norm.stack ? truncateStr(norm.stack, 1500) : null,
        component_stack: extra?.componentStack
          ? truncateStr(extra.componentStack, 1000)
          : null,
        // Epoch ms del lado Rust (solo source:'rust'): correlaciona contra
        // maity.log; created_at puede llegar segundos después por el pipeline.
        rust_ts_ms: extra?.rustTsMs ?? null,
        pathname: typeof window !== 'undefined' ? window.location.pathname : null,
        dedup_key: key,
        seq,
        session_uptime_s: Math.round((Date.now() - startedAt) / 1000),
      },
      'error',
      message,
    )
  } catch {
    // La telemetría de errores jamás genera errores propios.
  } finally {
    reporting = false
  }
}

/**
 * Instala los handlers globales. Idempotente y SIN teardown a propósito: si el
 * ErrorBoundary desmonta el árbol React, estos handlers deben seguir vivos.
 */
export function initErrorTelemetry(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    // Errores de carga de recursos (img/script) llegan con target ≠ window:
    // sin señal diagnóstica útil, fuera.
    if (event.target && event.target !== window) return
    reportCaughtError('window', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportCaughtError('unhandledrejection', event.reason)
  })

  // Puente rust-error: los ERROR de tareas background de Rust que ningún
  // invoke reporta. Solo la ventana principal monta este módulo (early return
  // del layout para las aux), así que el emit broadcast no se multiplica.
  try {
    void listen<RustErrorPayload>(TauriEvent.RUST_ERROR, (event) => {
      const err = new Error(event.payload.message)
      err.name = event.payload.target
      // El stack apuntaría a este listener, no al error real de Rust — fuera.
      err.stack = undefined
      reportCaughtError('rust', err, { rustTsMs: event.payload.ts_ms })
    }).catch(() => {
      // Sin runtime Tauri (dev browser / tests): el puente simplemente no existe.
    })
  } catch {
    // Ídem: jamás romper el init de telemetría por el puente.
  }
}
