/**
 * useDeepgramJwtRefresh
 *
 * A.1 — Bridge between the Rust Deepgram provider and the Vercel proxy-config
 * endpoint. When the JWT (5 min TTL) is about to expire mid-recording, the
 * Rust side emits `deepgram-jwt-refresh-needed`. This hook listens, fetches
 * a fresh proxy config, and writes it back to the Rust cache via the
 * `set_deepgram_proxy_config` command (called internally by
 * `getDeepgramProxyConfig`).
 *
 * Mount once at app root (layout) or in the recording context so the listener
 * is active for the full life of any recording session.
 */
import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getDeepgramProxyConfig } from '@/lib/deepgram'

export function useDeepgramJwtRefresh(): void {
  // Coalesce concurrent refresh requests. Both mic and sys providers can
  // fire the event within the same second; we only need one refresh.
  const inFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined

    const run = async () => {
      unlisten = await listen<{ source?: string }>(
        'deepgram-jwt-refresh-needed',
        async (event) => {
          const source = event.payload?.source ?? 'unknown'
          console.log(`[deepgram-jwt-refresh] request from Rust (source=${source})`)

          if (inFlightRef.current) {
            console.log('[deepgram-jwt-refresh] coalescing into in-flight refresh')
            return inFlightRef.current
          }

          const task = (async () => {
            try {
              await getDeepgramProxyConfig()
              console.log('[deepgram-jwt-refresh] proxy config refreshed successfully')
            } catch (err) {
              console.error('[deepgram-jwt-refresh] refresh failed:', err)
              // Rust will see `refresh_jwt_if_needed` timeout and return AuthExpired.
              // The circuit breaker / backpressure path will surface this to the user
              // in later phases (A.3 / B.1).
            } finally {
              inFlightRef.current = null
            }
          })()
          inFlightRef.current = task
          return task
        }
      )
    }

    run()

    return () => {
      if (unlisten) unlisten()
    }
  }, [])
}
