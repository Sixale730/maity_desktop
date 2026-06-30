'use client'

import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

/**
 * Listener global de la grabación programada. Vive en el layout (dentro de todos los
 * providers) y traduce los eventos best-effort del scheduler Rust en feedback de UI.
 * Renderiza null: el núcleo del feature NO depende de este componente (la grabación
 * arranca en Rust aunque la ventana esté minimizada).
 */
export function ScheduledRecordingIndicator() {
  const prevPhase = useRef<string | null>(null)

  useEffect(() => {
    const subscriptions = [
      listen<{ phase: string; next_fire_at: string | null; in_window: boolean }>(
        'scheduled-recording-status',
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
      ),
      listen<{ reason: string; message: string }>('scheduled-recording-skipped', (event) => {
        const message = event.payload?.message
        if (message) toast.info(message)
      }),
    ]

    return () => {
      subscriptions.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [])

  return null
}

export default ScheduledRecordingIndicator
