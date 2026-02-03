'use client'

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface NetworkStatus {
  isOnline: boolean
  isBackendReachable: boolean
  lastChecked: Date | null
}

interface UseNetworkStatusOptions {
  /** How often to check backend connectivity (ms). Default: 30000 (30 seconds) */
  checkInterval?: number
  /** Whether to perform backend health checks. Default: true */
  checkBackend?: boolean
}

// In Tauri's WebView2 on Windows, navigator.onLine incorrectly returns false
// because the webview loads from localhost without real network context.
// Desktop apps always have system-level network access, so we bypass that check.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Hook to monitor network connectivity status
 *
 * Monitors both browser online/offline events and backend reachability.
 * In Tauri (desktop), navigator.onLine is unreliable and is bypassed.
 */
export function useNetworkStatus(options: UseNetworkStatusOptions = {}): NetworkStatus {
  const { checkInterval = 30000, checkBackend = true } = options

  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: isTauri ? true : (typeof navigator !== 'undefined' ? navigator.onLine : true),
    isBackendReachable: true,
    lastChecked: null,
  })

  // Check backend connectivity
  const checkBackendConnectivity = useCallback(async () => {
    if (!checkBackend) return

    try {
      // Use a simple backend health check command
      await invoke<boolean>('health_check')
      setStatus(prev => ({
        ...prev,
        isBackendReachable: true,
        lastChecked: new Date(),
      }))
    } catch (error) {
      console.warn('[useNetworkStatus] Backend health check failed:', error)
      setStatus(prev => ({
        ...prev,
        isBackendReachable: false,
        lastChecked: new Date(),
      }))
    }
  }, [checkBackend])

  // Handle browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log('[useNetworkStatus] Browser reports online')
      setStatus(prev => ({ ...prev, isOnline: true }))
      // Check backend when coming back online
      checkBackendConnectivity()
    }

    const handleOffline = () => {
      if (isTauri) {
        // Ignore offline events in Tauri - navigator.onLine is unreliable in WebView2
        console.log('[useNetworkStatus] Ignoring offline event in Tauri (unreliable in WebView2)')
        return
      }
      console.log('[useNetworkStatus] Browser reports offline')
      setStatus(prev => ({
        ...prev,
        isOnline: false,
        isBackendReachable: false,
      }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [checkBackendConnectivity])

  // Periodic backend connectivity check
  useEffect(() => {
    if (!checkBackend) return

    // Initial check
    checkBackendConnectivity()

    // Set up interval
    const interval = setInterval(checkBackendConnectivity, checkInterval)

    return () => clearInterval(interval)
  }, [checkBackend, checkInterval, checkBackendConnectivity])

  return status
}

export default useNetworkStatus
