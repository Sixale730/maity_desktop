import { describe, it, expect } from 'vitest'
import {
  extractQueryParams,
  extractTokensFromUrl,
  extractAuthCode,
  extractAuthError,
} from './authCallbackUrl'

describe('extractQueryParams', () => {
  it('lee el query y se detiene en el fragment', () => {
    const p = extractQueryParams('maity://auth/confirm?token_hash=abc&type=signup#x=1')
    expect(p.get('token_hash')).toBe('abc')
    expect(p.get('type')).toBe('signup')
    expect(p.get('x')).toBeNull()
  })

  it('devuelve vacío sin query', () => {
    expect(extractQueryParams('maity://auth/callback').toString()).toBe('')
    expect(extractQueryParams('maity://auth/callback#access_token=a').get('access_token')).toBeNull()
  })
})

describe('extractAuthCode (PKCE — el flujo actual)', () => {
  it('extrae ?code= del query', () => {
    expect(extractAuthCode('maity://auth/callback?code=abc-123')).toBe('abc-123')
  })

  it('el code del query gana aunque haya fragment', () => {
    expect(extractAuthCode('maity://auth/callback?code=abc#access_token=t&refresh_token=r')).toBe('abc')
  })

  it('null sin code o con code vacío', () => {
    expect(extractAuthCode('maity://auth/callback')).toBeNull()
    expect(extractAuthCode('maity://auth/callback?code=')).toBeNull()
    expect(extractAuthCode('maity://auth/callback#access_token=t&refresh_token=r')).toBeNull()
    expect(extractAuthCode('maity://auth/callback#code=abc')).toBeNull()
  })
})

describe('extractTokensFromUrl (flujo implícito)', () => {
  it('extrae el par del fragment', () => {
    expect(extractTokensFromUrl('maity://auth/callback#access_token=t&refresh_token=r&expires_in=3600')).toEqual({
      accessToken: 't',
      refreshToken: 'r',
    })
  })

  it('null si falta uno de los dos o no hay fragment', () => {
    expect(extractTokensFromUrl('maity://auth/callback#access_token=t')).toBeNull()
    expect(extractTokensFromUrl('maity://auth/callback#refresh_token=r')).toBeNull()
    expect(extractTokensFromUrl('maity://auth/callback?access_token=t&refresh_token=r')).toBeNull()
    expect(extractTokensFromUrl('maity://auth/callback')).toBeNull()
  })
})

describe('extractAuthError', () => {
  it('lee error + error_description (URL-encoded)', () => {
    expect(
      extractAuthError('maity://auth/callback?error=access_denied&error_description=User%20denied%20access'),
    ).toEqual({ error: 'access_denied', description: 'User denied access' })
  })

  it('description null si no viene', () => {
    expect(extractAuthError('maity://auth/callback?error=server_error')).toEqual({
      error: 'server_error',
      description: null,
    })
  })

  it('null sin error (incluido un callback con code válido)', () => {
    expect(extractAuthError('maity://auth/callback?code=abc')).toBeNull()
    expect(extractAuthError('maity://auth/callback')).toBeNull()
  })
})
