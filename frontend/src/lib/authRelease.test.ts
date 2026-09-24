import { describe, it, expect } from 'vitest'
import { shouldReleaseRustUser, isBootSessionUncertain } from './authRelease'

describe('shouldReleaseRustUser', () => {
  it('montaje durante la recarga del webview (auth aún cargando) NO suelta a Rust — el bug', () => {
    expect(shouldReleaseRustUser(null, null, false)).toBe(false)
  })

  it('arranque incierto (sin sesión por red caída ⇒ authReady false) NO suelta a Rust', () => {
    // AuthContext: authReady = !isLoading && !user && !bootSessionUncertain, con isLoading
    // ya en false y user null, pero getSession falló por red.
    const authReady = !isBootSessionUncertain(false, true, true)
    expect(authReady).toBe(false)
    expect(shouldReleaseRustUser(null, null, authReady)).toBe(false)
  })

  it('la inicialización terminó sin usuario ⇒ suelta', () => {
    expect(shouldReleaseRustUser(null, null, true)).toBe(true)
  })

  it('transición real Some→None (logout o sesión perdida) suelta aunque auth no esté lista', () => {
    expect(shouldReleaseRustUser('u1', null, false)).toBe(true)
    expect(shouldReleaseRustUser('u1', null, true)).toBe(true)
  })

  it('con usuario nunca suelta (el efecto hace set_current_user)', () => {
    expect(shouldReleaseRustUser(null, 'u1', false)).toBe(false)
    expect(shouldReleaseRustUser(null, 'u1', true)).toBe(false)
  })

  it('cambio de cuenta no suelta: lo cubre set_current_user', () => {
    expect(shouldReleaseRustUser('u1', 'u2', true)).toBe(false)
  })
})

describe('isBootSessionUncertain', () => {
  it('con sesión nunca es incierto', () => {
    expect(isBootSessionUncertain(true, true, false)).toBe(false)
    expect(isBootSessionUncertain(true, false, true)).toBe(false)
  })

  it('sin sesión por error reintentable (red) es incierto', () => {
    expect(isBootSessionUncertain(false, true, true)).toBe(true)
  })

  it('sin sesión y offline es incierto', () => {
    expect(isBootSessionUncertain(false, false, false)).toBe(true)
  })

  it('sin sesión, online y sin error reintentable ⇒ sin usuario de verdad', () => {
    expect(isBootSessionUncertain(false, false, true)).toBe(false)
  })
})
