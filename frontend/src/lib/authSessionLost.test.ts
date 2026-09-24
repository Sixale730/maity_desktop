import { describe, it, expect } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'
import { signedOutSessionLostSource, shouldReportBootNoSession, authErrorName } from './authSessionLost'

describe('signedOutSessionLostSource', () => {
  it('SIGNED_OUT espontáneo (sin sesión nueva, sin logout propio) ⇒ webview_signed_out', () => {
    expect(signedOutSessionLostSource('SIGNED_OUT', false, false)).toBe('webview_signed_out')
  })

  it('SIGNED_OUT durante el logout del usuario ⇒ null', () => {
    expect(signedOutSessionLostSource('SIGNED_OUT', false, true)).toBeNull()
  })

  it('SIGNED_OUT con sesión nueva ⇒ null', () => {
    expect(signedOutSessionLostSource('SIGNED_OUT', true, false)).toBeNull()
  })

  it('otros eventos ⇒ null', () => {
    expect(signedOutSessionLostSource('TOKEN_REFRESHED', false, false)).toBeNull()
    expect(signedOutSessionLostSource('INITIAL_SESSION', false, false)).toBeNull()
  })
})

describe('shouldReportBootNoSession', () => {
  it('con sesión ⇒ nunca', () => {
    expect(shouldReportBootNoSession(true, null, true)).toBe(false)
  })

  it('sin sesión y sin error ⇒ reportar (online true o desconocido)', () => {
    expect(shouldReportBootNoSession(false, null, true)).toBe(true)
    expect(shouldReportBootNoSession(false, null, undefined)).toBe(true)
  })

  it('offline ⇒ no reportar', () => {
    expect(shouldReportBootNoSession(false, null, false)).toBe(false)
  })

  it('error reintentable (red) ⇒ no reportar', () => {
    expect(shouldReportBootNoSession(false, new AuthRetryableFetchError('net', 0), true)).toBe(false)
  })

  it('error NO reintentable (refresh rechazado) ⇒ reportar', () => {
    expect(
      shouldReportBootNoSession(false, new AuthApiError('invalid', 400, 'refresh_token_not_found'), true),
    ).toBe(true)
    expect(shouldReportBootNoSession(false, new AuthSessionMissingError(), true)).toBe(true)
  })
})

describe('authErrorName', () => {
  it('extrae el name solo si es string', () => {
    expect(authErrorName(null)).toBeNull()
    expect(authErrorName(undefined)).toBeNull()
    expect(authErrorName({ name: 'AuthApiError' })).toBe('AuthApiError')
    expect(authErrorName({ name: 42 })).toBeNull()
    expect(authErrorName('x')).toBeNull()
    expect(authErrorName(new AuthSessionMissingError())).toBe('AuthSessionMissingError')
  })
})
