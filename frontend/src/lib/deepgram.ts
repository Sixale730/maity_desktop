/**
 * Deepgram Proxy Config Service
 *
 * Provides proxy configuration for Deepgram transcription via Cloudflare Worker proxy.
 * The Deepgram API key never reaches the client — the proxy holds it server-side.
 *
 * Flow: Frontend gets Supabase session → invokes Rust command with access_token
 *       → Rust fetches from Vercel API (no CORS) → caches and returns config
 *       → Rust connects to Cloudflare Worker → Worker connects to Deepgram
 */

import { invoke } from '@tauri-apps/api/core'
import { supabase } from './supabase'

export interface DeepgramProxyConfig {
  proxyBaseUrl: string
  jwt: string
  expiresIn: number
}

export interface DeepgramTokenError {
  error: string
  details?: string
}

export type DeepgramErrorType = 'auth' | 'network' | 'server' | 'unknown'

export class DeepgramError extends Error {
  public readonly errorType: DeepgramErrorType

  constructor(message: string, errorType: DeepgramErrorType) {
    super(message)
    this.name = 'DeepgramError'
    this.errorType = errorType
  }
}

/**
 * Get proxy configuration for Deepgram streaming transcription.
 * The Rust backend handles HTTP fetching (no CORS), caching, and config parsing.
 *
 * @returns Promise<DeepgramProxyConfig> - Proxy base URL, JWT, and expiration info
 * @throws DeepgramError if user is not authenticated or config generation fails
 */
export async function getDeepgramProxyConfig(): Promise<DeepgramProxyConfig> {
  // Get current session
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    console.error('[deepgram] Session error:', sessionError.message)
    throw new DeepgramError(
      `Error de sesión: ${sessionError.message}. Intenta cerrar sesión y volver a iniciar.`,
      'auth'
    )
  }

  if (!session) {
    console.error('[deepgram] No active session - user must be logged in')
    throw new DeepgramError('Debes iniciar sesión para grabar', 'auth')
  }

  console.log('[deepgram] Fetching proxy config via Rust backend...')

  try {
    // Rust command handles: HTTP fetch, caching, URL parsing, error classification
    const result = await invoke<{ proxy_base_url: string; jwt: string; expires_in: number }>(
      'fetch_deepgram_proxy_config',
      { accessToken: session.access_token }
    )

    console.log('[deepgram] Proxy config obtained, expires in', result.expires_in, 's')
    console.log('[deepgram] Proxy base URL:', result.proxy_base_url)

    return {
      proxyBaseUrl: result.proxy_base_url,
      jwt: result.jwt,
      expiresIn: result.expires_in,
    }
  } catch (err) {
    const errorStr = String(err)
    console.error('[deepgram] Rust fetch error:', errorStr)

    // Rust errors are prefixed with error type: "auth:message", "network:message", etc.
    const colonIndex = errorStr.indexOf(':')
    if (colonIndex > 0 && colonIndex < 10) {
      const errorType = errorStr.substring(0, colonIndex) as DeepgramErrorType
      const message = errorStr.substring(colonIndex + 1)
      if (['auth', 'network', 'server', 'unknown'].includes(errorType)) {
        // If auth error, try refreshing session and retry once
        if (errorType === 'auth') {
          console.warn('[deepgram] Auth error - attempting session refresh...')
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()

          if (!refreshError && refreshData.session) {
            console.log('[deepgram] Session refreshed, retrying...')
            try {
              const retryResult = await invoke<{ proxy_base_url: string; jwt: string; expires_in: number }>(
                'fetch_deepgram_proxy_config',
                { accessToken: refreshData.session.access_token }
              )
              return {
                proxyBaseUrl: retryResult.proxy_base_url,
                jwt: retryResult.jwt,
                expiresIn: retryResult.expires_in,
              }
            } catch (retryErr) {
              console.error('[deepgram] Retry after refresh also failed:', retryErr)
            }
          }
        }
        throw new DeepgramError(message, errorType)
      }
    }

    throw new DeepgramError(errorStr, 'unknown')
  }
}

/**
 * Clear the cached proxy config (both TS and Rust side).
 * Call this when the user logs out.
 */
export async function clearDeepgramProxyCache(): Promise<void> {
  try {
    await invoke('clear_deepgram_proxy_config')
  } catch (e) {
    console.warn('[deepgram] Failed to clear Rust cache:', e)
  }
  console.log('[deepgram] Proxy config cache cleared')
}

/**
 * Check if a valid proxy config is currently cached in Rust.
 */
export async function hasValidCachedProxyConfig(): Promise<boolean> {
  try {
    return await invoke<boolean>('has_valid_deepgram_proxy_config')
  } catch {
    return false
  }
}
