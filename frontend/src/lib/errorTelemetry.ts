/**
 * Telemetría de errores — eventos `app.error` a `maity.platform_logs`.
 *
 * Fuentes: handlers globales de `window` ('error' + 'unhandledrejection', que
 * de facto cubren muchos fallos originados en Rust — los rechazos de `invoke()`
 * llegan como strings), `ErrorBoundary.componentDidCatch` y `DbInitErrorGate`
 * ('db-init'). Los `log::error!` de tareas background de Rust YA NO pasan por
 * aquí: `logging/rust_error_bridge.rs` los escribe al outbox nativo como
 * `app.error` `source:'rust'` (hasta 0.2.59 llegaban por el evento Tauri
 * `rust-error` y este módulo los reenviaba — con la ventana en tray WebView2
 * dormía y se perdían). Hookear `logger.error` quedó DESCARTADO (issue #63,
 * cerrado como no-planeado): ruido de errores manejados de rutina, doble
 * conteo con los handlers de window y el vector de bucle más peligroso.
 *
 * Presupuesto por sesión de ventana y POR FUENTE (`SOURCE_BUDGETS`), dedup por
 * (name+message), mínimo 2s entre envíos, sin cola. Los repetidos solo cuentan
 * local.
 *
 * REGLA ANTI-BUCLE: dentro de este módulo está prohibido `logger.*` y
 * `console.*`; todo el path de envío va en try/catch vacío y `platformLogger`
 * nunca lanza ni rechaza — un fallo del propio envío no re-dispara
 * 'unhandledrejection'. El layer Rust excluye el target "frontend"
 * (`log_frontend_event`): el bucle JS→Rust→JS está cortado del lado Rust.
 */
import { platformLogger } from '@/lib/platformLogger'

export const MIN_REPORT_GAP_MS = 2_000

export type ErrorSource = 'window' | 'unhandledrejection' | 'error-boundary' | 'db-init'

/**
 * Presupuesto POR FUENTE (anti noisy-neighbor): antes las fuentes compartían
 * un cap de 20 y un render-loop de React se comía el cupo entero. Ahora cada
 * fuente agota solo lo suyo. Los ERROR de Rust ya no pasan por este limiter:
 * el puente escribe al outbox con su propio `BridgeLimiter` (20/proceso).
 */
export const SOURCE_BUDGETS: Record<ErrorSource, number> = {
  window: 8,
  unhandledrejection: 8,
  'error-boundary': 5,
  'db-init': 3,
}

/** Fuentes futuras no listadas: presupuesto conservador. */
export const DEFAULT_SOURCE_BUDGET = 5

/** Contadores monótonos por sesión de ventana, para el err_budget del heartbeat. */
export interface ErrorBudgetStats {
  sent: number
  dropped_dedup: number
  dropped_cap: number
  dropped_gap: number
  sent_by_source: Record<string, number>
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
 * Rate-limit + dedup por sesión, con presupuesto POR FUENTE y contadores de
 * descarte. Estado puro, exportado para unit tests. Los excedentes se
 * DESCARTAN sin cola: una tormenta de render-loop no debe convertirse en N
 * RPCs en un segundo.
 *
 * El dedup mira lo ENVIADO (`sentKeys`), no lo visto: antes un error
 * descartado por el gap de 2 s quedaba marcado como visto y su siguiente
 * ocurrencia jamás se enviaba — se perdía el primer error de cada ráfaga.
 */
export class ErrorReportLimiter {
  private sent = 0
  private lastSentAt = 0
  private readonly seen = new Map<string, number>()
  private readonly sentKeys = new Set<string>()
  private readonly sentBySource = new Map<string, number>()
  private droppedDedup = 0
  private droppedCap = 0
  private droppedGap = 0

  constructor(
    private readonly budgets: Record<string, number> = SOURCE_BUDGETS,
    private readonly minGapMs = MIN_REPORT_GAP_MS,
  ) {}

  /** true si este error debe ENVIARSE. Siempre cuenta la ocurrencia local. */
  shouldReport(source: string, key: string, now = Date.now()): boolean {
    this.seen.set(key, (this.seen.get(key) ?? 0) + 1)
    if (this.sentKeys.has(key)) {
      this.droppedDedup += 1
      return false
    }
    const budget = this.budgets[source] ?? DEFAULT_SOURCE_BUDGET
    if ((this.sentBySource.get(source) ?? 0) >= budget) {
      this.droppedCap += 1
      return false
    }
    if (this.lastSentAt !== 0 && now - this.lastSentAt < this.minGapMs) {
      this.droppedGap += 1
      return false
    }
    this.sent += 1
    this.lastSentAt = now
    this.sentKeys.add(key)
    this.sentBySource.set(source, (this.sentBySource.get(source) ?? 0) + 1)
    return true
  }

  occurrences(key: string): number {
    return this.seen.get(key) ?? 0
  }

  /** Invariante: sent + Σdropped == intentos que llegaron al limiter. */
  stats(): ErrorBudgetStats {
    return {
      sent: this.sent,
      dropped_dedup: this.droppedDedup,
      dropped_cap: this.droppedCap,
      dropped_gap: this.droppedGap,
      sent_by_source: Object.fromEntries(this.sentBySource),
    }
  }
}

const limiter = new ErrorReportLimiter()
const startedAt = Date.now()
let installed = false
let reporting = false
let seq = 0

/** Contadores del limiter de esta ventana, para el err_budget del heartbeat. */
export function getErrorTelemetryStats(): ErrorBudgetStats {
  return limiter.stats()
}

export function reportCaughtError(
  source: ErrorSource,
  error: unknown,
  extra?: { componentStack?: string },
): void {
  // Guard síncrono: si construir/enviar el reporte lanza y eso re-entra aquí,
  // cortamos en seco.
  if (reporting) return
  reporting = true
  try {
    const norm = normalizeError(error)
    const key = buildErrorKey(norm.name, norm.message)
    if (!limiter.shouldReport(source, key)) return

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
}
