'use client'

import { useEffect, useRef } from 'react'
import { createSubscriptionGroup } from '@/lib/tauriSubscribe'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { TauriEvent } from '@/lib/tauri-events'

/**
 * Listener global de la grabación programada. Vive en el layout (dentro de todos los
 * providers) y traduce los eventos best-effort del scheduler Rust en feedback de UI.
 * Renderiza null: el núcleo del feature NO depende de este componente (la grabación
 * arranca en Rust aunque la ventana esté minimizada).
 */
export function ScheduledRecordingIndicator() {
  const prevPhase = useRef<string | null>(null)

  useEffect(() => {
    const subs = createSubscriptionGroup()
    subs.on<{ phase: string; next_fire_at: string | null; in_window: boolean }>(
      TauriEvent.SCHEDULED_RECORDING_STATUS,
      (event) => {
        const phase = event.payload?.phase
        if (!phase || phase === prevPhase.current) return
        // Avisar solo en el arranque real (no en la sincronización inicial de mount).
        if (phase === 'recording' && prevPhase.current !== null) {
          toast.success('Grabación de jornada iniciada')
        }
        prevPhase.current = phase
        logger.debug('[ScheduledRecording] phase:', phase)
      }
    )
    subs.on<{ reason: string; message: string }>(TauriEvent.SCHEDULED_RECORDING_SKIPPED, (event) => {
      const message = event.payload?.message
      if (message) toast.info(message)
    })

    return () => subs.dispose()
  }, [])

  return null
}

export default ScheduledRecordingIndicator
