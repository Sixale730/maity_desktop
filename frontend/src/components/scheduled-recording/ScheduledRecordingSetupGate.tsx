'use client'

import React from 'react'
import { ScheduledRecordingSetupCard } from './ScheduledRecordingSetupCard'
import {
  scheduledRecordingService,
  type ScheduleWindow,
} from '@/services/scheduledRecordingService'
import { logger } from '@/lib/logger'

interface ScheduledRecordingSetupGateProps {
  /** Llamado al activar, para que el layout cierre el gate. */
  onDone: () => void
}

/**
 * Gate de activación de la grabación por jornada. Bloquea la app hasta que el usuario
 * la ACTIVE (sin escape) — aplica a todos, nuevos y existentes. Si luego no la quiere,
 * la desactiva desde Ajustes. Sale UNA sola vez: al activar se marca `configured_by_user`
 * y no reaparece.
 */
export function ScheduledRecordingSetupGate({ onDone }: ScheduledRecordingSetupGateProps) {
  const handleActivate = async (window: ScheduleWindow) => {
    try {
      const current = await scheduledRecordingService.getSettings()
      await scheduledRecordingService.setSettings({
        ...current,
        windows: [window],
        enabled: true,
        configured_by_user: true,
      })
      // Arranca el loop de fondo en Rust.
      await scheduledRecordingService.setEnabled(true)
      logger.debug('[ScheduledSetupGate] activated')
    } catch (error) {
      console.error('[ScheduledSetupGate] activate failed:', error)
    } finally {
      onDone()
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
        <ScheduledRecordingSetupCard onActivate={handleActivate} />
      </div>
    </div>
  )
}

export default ScheduledRecordingSetupGate
