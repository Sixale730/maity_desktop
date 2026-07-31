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
  normalizeError,
  reportCaughtError,
  truncateStr,
} from './errorTelemetry'

describe('ErrorReportLimiter', () => {
  it('envía la primera ocurrencia y dedupea las repetidas', () => {
    const limiter = new ErrorReportLimiter(20, 0)
    expect(limiter.shouldReport('a')).toBe(true)
    expect(limiter.shouldReport('a')).toBe(false)
    expect(limiter.shouldReport('a')).toBe(false)
    expect(limiter.occurrences('a')).toBe(3)
  })

  it('keys distintas cuentan por separado hasta el cap', () => {
    const limiter = new ErrorReportLimiter(3, 0)
    expect(limiter.shouldReport('a')).toBe(true)
    expect(limiter.shouldReport('b')).toBe(true)
    expect(limiter.shouldReport('c')).toBe(true)
    expect(limiter.shouldReport('d')).toBe(false)
    // Excedente descartado, no encolado: sigue bloqueado.
    expect(limiter.shouldReport('e')).toBe(false)
  })

  it('anti-burst: respeta el gap mínimo entre envíos', () => {
    const limiter = new ErrorReportLimiter(20, 2000)
    expect(limiter.shouldReport('a', 1000)).toBe(true)
    expect(limiter.shouldReport('b', 2000)).toBe(false)
    expect(limiter.shouldReport('c', 3100)).toBe(true)
  })

  it('el cap cuenta envíos, no ocurrencias', () => {
    const limiter = new ErrorReportLimiter(2, 0)
    expect(limiter.shouldReport('a')).toBe(true)
    limiter.shouldReport('a')
    limiter.shouldReport('a')
    expect(limiter.shouldReport('b')).toBe(true)
    expect(limiter.shouldReport('c')).toBe(false)
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
