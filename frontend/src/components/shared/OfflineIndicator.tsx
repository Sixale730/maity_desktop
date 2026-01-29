'use client'

import React from 'react'
import { WifiOff, AlertTriangle } from 'lucide-react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

interface OfflineIndicatorProps {
  /** Show indicator even when only backend is unreachable. Default: true */
  showBackendWarning?: boolean
  /** Custom className for the container */
  className?: string
}

/**
 * Offline indicator component
 *
 * Displays a banner when the user is offline or the backend is unreachable.
 * Positioned at the top of the app.
 */
export function OfflineIndicator({
  showBackendWarning = true,
  className = ''
}: OfflineIndicatorProps) {
  const { isOnline, isBackendReachable } = useNetworkStatus({
    checkInterval: 30000,
    checkBackend: showBackendWarning,
  })

  // Fully offline (no network)
  if (!isOnline) {
    return (
      <div className={`bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm ${className}`}>
        <WifiOff className="h-4 w-4" />
        <span>Sin conexión a Internet. Algunas funciones no estarán disponibles.</span>
      </div>
    )
  }

  // Online but backend unreachable
  if (showBackendWarning && !isBackendReachable) {
    return (
      <div className={`bg-yellow-100 text-yellow-800 px-4 py-2 flex items-center justify-center gap-2 text-sm ${className}`}>
        <AlertTriangle className="h-4 w-4" />
        <span>Verificando conexión con el servidor...</span>
      </div>
    )
  }

  // Everything is fine, don't render anything
  return null
}

export default OfflineIndicator
