'use client'

import { useEffect, useRef } from 'react'

/**
 * ChunkErrorRecovery: Detects ChunkLoadError (common in Next.js dev mode)
 * and automatically reloads the page after a short delay.
 *
 * This is particularly useful when Tauri opens the webview before
 * Next.js has finished compiling all chunks.
 */
export function ChunkErrorRecovery() {
  const reloadAttemptedRef = useRef(false)
  const reloadCountRef = useRef(0)
  const MAX_RELOAD_ATTEMPTS = 3
  const RELOAD_DELAY_MS = 1500

  useEffect(() => {
    // Only active in development mode
    if (process.env.NODE_ENV !== 'development') {
      return
    }

    // Check session storage for reload count to prevent infinite loops
    const storedCount = sessionStorage.getItem('chunkErrorReloadCount')
    if (storedCount) {
      reloadCountRef.current = parseInt(storedCount, 10)
      // Clear the count after 30 seconds of successful loading
      setTimeout(() => {
        sessionStorage.removeItem('chunkErrorReloadCount')
      }, 30000)
    }

    const handleError = (event: ErrorEvent) => {
      const message = event.message || ''
      const isChunkError =
        message.includes('ChunkLoadError') ||
        message.includes('Loading chunk') ||
        message.includes('chunk') && message.includes('failed') ||
        (event.error?.name === 'ChunkLoadError')

      if (isChunkError && !reloadAttemptedRef.current) {
        console.warn('[ChunkErrorRecovery] Detected chunk load error:', message)

        if (reloadCountRef.current >= MAX_RELOAD_ATTEMPTS) {
          console.error(
            `[ChunkErrorRecovery] Max reload attempts (${MAX_RELOAD_ATTEMPTS}) reached. ` +
            'Please restart the dev server with: pnpm run tauri:dev'
          )
          sessionStorage.removeItem('chunkErrorReloadCount')
          return
        }

        reloadAttemptedRef.current = true
        reloadCountRef.current++
        sessionStorage.setItem('chunkErrorReloadCount', String(reloadCountRef.current))

        console.log(
          `[ChunkErrorRecovery] Reloading page in ${RELOAD_DELAY_MS}ms... ` +
          `(attempt ${reloadCountRef.current}/${MAX_RELOAD_ATTEMPTS})`
        )

        setTimeout(() => {
          window.location.reload()
        }, RELOAD_DELAY_MS)
      }
    }

    // Handle unhandled promise rejections (dynamic imports fail this way)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason?.message || String(reason) || ''

      const isChunkError =
        message.includes('ChunkLoadError') ||
        message.includes('Loading chunk') ||
        message.includes('Failed to fetch dynamically imported module') ||
        (reason?.name === 'ChunkLoadError')

      if (isChunkError && !reloadAttemptedRef.current) {
        console.warn('[ChunkErrorRecovery] Detected chunk load rejection:', message)

        if (reloadCountRef.current >= MAX_RELOAD_ATTEMPTS) {
          console.error(
            `[ChunkErrorRecovery] Max reload attempts (${MAX_RELOAD_ATTEMPTS}) reached. ` +
            'Please restart the dev server with: pnpm run tauri:dev'
          )
          sessionStorage.removeItem('chunkErrorReloadCount')
          return
        }

        reloadAttemptedRef.current = true
        reloadCountRef.current++
        sessionStorage.setItem('chunkErrorReloadCount', String(reloadCountRef.current))

        console.log(
          `[ChunkErrorRecovery] Reloading page in ${RELOAD_DELAY_MS}ms... ` +
          `(attempt ${reloadCountRef.current}/${MAX_RELOAD_ATTEMPTS})`
        )

        setTimeout(() => {
          window.location.reload()
        }, RELOAD_DELAY_MS)
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null
}
