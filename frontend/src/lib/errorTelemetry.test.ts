/**
 * Tests del rate-limit/dedup de la telemetría de errores y de la
 * normalización (los rechazos de `invoke()` Rust llegan como strings).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platformLogger', () => ({ platformLogger: { log: vi.fn() } }))

import { platformLogger } from '@/lib/platformLogger'
import {
  ErrorReportLimiter,
  buildErrorKey,
  initErrorTelemetry,
  normalizeError,
  reportCaughtError,
  truncateStr,
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

  it('presupuesto POR FUENTE: window agotado no bloquea a otra fuente (anti noisy-neighbor)', () => {
    const limiter = new ErrorReportLimiter({ window: 1, 'db-init': 2 }, 0)
    expect(limiter.shouldReport('window', 'w1')).toBe(true)
    expect(limiter.shouldReport('window', 'w2')).toBe(false)
    // El render-loop de React no se come el cupo de las demás fuentes
    expect(limiter.shouldReport('db-init', 'd1')).toBe(true)
    expect(limiter.shouldReport('db-init', 'd2')).toBe(true)
    expect(limiter.shouldReport('db-init', 'd3')).toBe(false)
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

describe('initErrorTelemetry', () => {
  it('es idempotente: el doble init no lanza ni duplica handlers', () => {
    expect(() => {
      initErrorTelemetry()
      initErrorTelemetry()
    }).not.toThrow()
  })
})
