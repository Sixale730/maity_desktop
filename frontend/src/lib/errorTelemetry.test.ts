/**
 * Tests del rate-limit/dedup de la telemetría de errores y de la
 * normalización (los rechazos de `invoke()` Rust llegan como strings).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platformLogger', () => ({ platformLogger: { log: vi.fn() } }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

import { listen } from '@tauri-apps/api/event'
import { platformLogger } from '@/lib/platformLogger'
import { TauriEvent } from '@/lib/tauri-events'
import {
  ErrorReportLimiter,
  buildErrorKey,
  initErrorTelemetry,
  normalizeError,
  reportCaughtError,
  truncateStr,
  type RustErrorPayload,
} from './errorTelemetry'

describe('ErrorReportLimiter', () => {
  it('envía la primera ocurrencia y dedupea las repetidas', () => {
    const limiter = new ErrorReportLimiter({ window: 20 }, 0)
    expect(limiter.shouldReport('window', 'a')).toBe(true)
    expect(limiter.shouldReport('window', 'a')).toBe(false)
    expect(limiter.shouldReport('window', 'a')).toBe(false)
    expect(limiter.occurrences('a')).toBe(3)
  })

  it('keys distintas cuentan por separado hasta el cap de la fuente', () => {
    const limiter = new ErrorReportLimiter({ window: 3 }, 0)
    expect(limiter.shouldReport('window', 'a')).toBe(true)
    expect(limiter.shouldReport('window', 'b')).toBe(true)
    expect(limiter.shouldReport('window', 'c')).toBe(true)
    expect(limiter.shouldReport('window', 'd')).toBe(false)
    // Excedente descartado, no encolado: sigue bloqueado.
    expect(limiter.shouldReport('window', 'e')).toBe(false)
  })

  it('anti-burst: respeta el gap mínimo entre envíos', () => {
    const limiter = new ErrorReportLimiter({ window: 20 }, 2000)
    expect(limiter.shouldReport('window', 'a', 1000)).toBe(true)
    expect(limiter.shouldReport('window', 'b', 2000)).toBe(false)
    expect(limiter.shouldReport('window', 'c', 3100)).toBe(true)
  })

  it('el cap cuenta envíos, no ocurrencias', () => {
    const limiter = new ErrorReportLimiter({ window: 2 }, 0)
    expect(limiter.shouldReport('window', 'a')).toBe(true)
    limiter.shouldReport('window', 'a')
    limiter.shouldReport('window', 'a')
    expect(limiter.shouldReport('window', 'b')).toBe(true)
    expect(limiter.shouldReport('window', 'c')).toBe(false)
  })

  it('presupuesto POR FUENTE: window agotado no bloquea a rust (anti noisy-neighbor)', () => {
    const limiter = new ErrorReportLimiter({ window: 1, rust: 2 }, 0)
    expect(limiter.shouldReport('window', 'w1')).toBe(true)
    expect(limiter.shouldReport('window', 'w2')).toBe(false)
    // El render-loop de React ya no se come el cupo de los ERROR de Rust (#60)
    expect(limiter.shouldReport('rust', 'r1')).toBe(true)
    expect(limiter.shouldReport('rust', 'r2')).toBe(true)
    expect(limiter.shouldReport('rust', 'r3')).toBe(false)
  })

  it('un drop por gap NO envenena el dedup: la siguiente ocurrencia sale', () => {
    const limiter = new ErrorReportLimiter({ window: 20 }, 2000)
    expect(limiter.shouldReport('window', 'a', 1000)).toBe(true)
    expect(limiter.shouldReport('window', 'b', 1500)).toBe(false)
    // Antes 'b' quedaba marcado como visto y jamás se enviaba (se perdía el
    // primer error de cada ráfaga). Hoy el dedup mira lo ENVIADO.
    expect(limiter.shouldReport('window', 'b', 4000)).toBe(true)
  })

  it('stats: sent + Σdropped == intentos, con desglose por causa', () => {
    const limiter = new ErrorReportLimiter({ window: 2 }, 2000)
    limiter.shouldReport('window', 'a', 1000) // sent
    limiter.shouldReport('window', 'a', 1100) // dedup
    limiter.shouldReport('window', 'b', 1200) // gap (aún dentro de 2s)
    limiter.shouldReport('window', 'b', 4000) // sent (el gap-drop no envenenó)
    limiter.shouldReport('window', 'c', 7000) // cap (window: 2 agotado)
    const stats = limiter.stats()
    expect(stats.sent).toBe(2)
    expect(stats.dropped_dedup).toBe(1)
    expect(stats.dropped_gap).toBe(1)
    expect(stats.dropped_cap).toBe(1)
    expect(stats.sent + stats.dropped_dedup + stats.dropped_gap + stats.dropped_cap).toBe(5)
    expect(stats.sent_by_source).toEqual({ window: 2 })
  })
})

describe('truncateStr / buildErrorKey', () => {
  it('trunca con elipsis solo cuando excede', () => {
    expect(truncateStr('corto', 10)).toBe('corto')
    expect(truncateStr('x'.repeat(12), 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('la key combina name y message truncado a 120', () => {
    const key = buildErrorKey('TypeError', 'm'.repeat(200))
    expect(key.startsWith('TypeError:')).toBe(true)
    expect(key.length).toBeLessThanOrEqual('TypeError:'.length + 121)
  })
})

describe('normalizeError', () => {
  it('Error nativo conserva name/message/stack', () => {
    const err = new TypeError('boom')
    const norm = normalizeError(err)
    expect(norm.name).toBe('TypeError')
    expect(norm.message).toBe('boom')
    expect(norm.stack).toBeDefined()
  })

  it('string (rechazo de invoke Rust) se etiqueta UnhandledRejection', () => {
    expect(normalizeError('Failed to start recording')).toEqual({
      name: 'UnhandledRejection',
      message: 'Failed to start recording',
    })
  })

  it('objetos arbitrarios se serializan sin lanzar', () => {
    const norm = normalizeError({ code: 42 })
    expect(norm.name).toBe('UnknownError')
    expect(norm.message).toContain('42')
  })
})

describe('reportCaughtError', () => {
  beforeEach(() => {
    vi.mocked(platformLogger.log).mockClear()
  })

  it('manda app.error una vez y dedupea el mismo error', () => {
    const err = new Error(`unico-${Date.now()}`)
    reportCaughtError('window', err)
    reportCaughtError('window', err)
    const calls = vi
      .mocked(platformLogger.log)
      .mock.calls.filter(([type]) => type === 'app.error')
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toBe('error')
  })

  it('nunca lanza aunque el error sea impresentable', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => reportCaughtError('unhandledrejection', circular)).not.toThrow()
  })
})

describe('puente rust-error', () => {
  beforeEach(() => {
    vi.mocked(platformLogger.log).mockClear()
  })

  // Un solo test: `initErrorTelemetry` es idempotente por flag de módulo, así
  // que el registro del listener solo ocurre una vez por archivo de test — no
  // se puede repartir en dos its (la limpieza de mocks entre tests borraría la
  // llamada registrada).
  it('doble init registra el listener UNA vez y mapea el payload a app.error', () => {
    expect(() => {
      initErrorTelemetry()
      initErrorTelemetry()
    }).not.toThrow()
    const rustCalls = vi
      .mocked(listen)
      .mock.calls.filter(([eventName]) => eventName === TauriEvent.RUST_ERROR)
    expect(rustCalls).toHaveLength(1)
    const handler = rustCalls[0][1] as (e: { payload: RustErrorPayload }) => void

    // El limiter del módulo es un singleton con gap de 2s compartido con los
    // tests anteriores — adelantar el reloj para que no suprima este envío.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 3_600_000)
      handler({
        payload: { target: 'app_lib::audio::worker', message: 'boom rust', ts_ms: 1234 },
      })
    } finally {
      vi.useRealTimers()
    }

    const calls = vi
      .mocked(platformLogger.log)
      .mock.calls.filter(([type]) => type === 'app.error')
    expect(calls).toHaveLength(1)
    const data = calls[0][1] as Record<string, unknown>
    expect(data.source).toBe('rust')
    expect(data.name).toBe('app_lib::audio::worker')
    expect(data.message).toBe('boom rust')
    expect(data.rust_ts_ms).toBe(1234)
    // El stack se descarta a propósito: apuntaría al listener, no a Rust.
    expect(data.stack).toBeNull()
  })
})
