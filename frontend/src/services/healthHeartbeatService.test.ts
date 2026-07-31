/**
 * Tests de la cadencia del heartbeat de salud.
 *
 * `shouldEmitHeartbeat` es pura y concentra la única lógica con riesgo real:
 * decidir por TIMESTAMPS (no por conteo de ticks) para que un sleep del laptop
 * produzca exactamente UN heartbeat al despertar y no una ráfaga.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('@/lib/platformLogger', () => ({ platformLogger: { log: vi.fn() } }))

import {
  ACTIVE_EMIT_EVERY_MS,
  HEARTBEAT_TOLERANCE_MS,
  IDLE_EMIT_EVERY_MS,
  shouldEmitHeartbeat,
} from './healthHeartbeatService'

const MIN = 60_000

describe('shouldEmitHeartbeat', () => {
  it('idle: no emite a los 5 ni 10 minutos', () => {
    expect(shouldEmitHeartbeat('idle', 5 * MIN)).toBe(false)
    expect(shouldEmitHeartbeat('idle', 10 * MIN)).toBe(false)
  })

  it('idle: emite a los 15 minutos', () => {
    expect(shouldEmitHeartbeat('idle', 15 * MIN)).toBe(true)
  })

  it('activo: emite a los 5 minutos en cualquier fase no-idle', () => {
    for (const phase of ['recording', 'paused', 'starting', 'stopping']) {
      expect(shouldEmitHeartbeat(phase, 5 * MIN)).toBe(true)
    }
  })

  it('activo: no emite antes de la ventana (menos tolerancia)', () => {
    expect(shouldEmitHeartbeat('recording', 4 * MIN)).toBe(false)
  })

  it('tolerancia: un tick con jitter a los 4:56 sí emite', () => {
    expect(shouldEmitHeartbeat('recording', 5 * MIN - HEARTBEAT_TOLERANCE_MS)).toBe(true)
    expect(shouldEmitHeartbeat('recording', 5 * MIN - HEARTBEAT_TOLERANCE_MS - 1)).toBe(false)
  })

  it('post-sleep: un elapsed gigante emite (una sola decisión, sin ráfaga)', () => {
    expect(shouldEmitHeartbeat('idle', 8 * 60 * MIN)).toBe(true)
    expect(shouldEmitHeartbeat('recording', 8 * 60 * MIN)).toBe(true)
  })

  it('las constantes mantienen la relación activo < idle', () => {
    expect(ACTIVE_EMIT_EVERY_MS).toBeLessThan(IDLE_EMIT_EVERY_MS)
  })
})
