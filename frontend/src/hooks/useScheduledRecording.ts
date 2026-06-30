import { useState, useEffect, useCallback } from 'react'
import {
  scheduledRecordingService,
  type ScheduledRecordingSettings,
  type ScheduledStatus,
} from '@/services/scheduledRecordingService'
import { logger } from '@/lib/logger'

/**
 * Carga/persiste la configuración de la grabación programada y expone el estado
 * actual del scheduler. Espejo conceptual del patrón de `useRecordingStart` pero
 * para la jornada.
 */
export function useScheduledRecording() {
  const [settings, setSettings] = useState<ScheduledRecordingSettings | null>(null)
  const [status, setStatus] = useState<ScheduledStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        scheduledRecordingService.getSettings(),
        scheduledRecordingService.getStatus(),
      ])
      setSettings(s)
      setStatus(st)
    } catch (error) {
      console.error('[useScheduledRecording] Failed to load:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Persiste la configuración completa (horarios, gracia, etc.). */
  const save = useCallback(async (next: ScheduledRecordingSettings) => {
    await scheduledRecordingService.setSettings(next)
    setSettings(next)
    logger.debug('[useScheduledRecording] settings saved')
  }, [])

  /** Atajo on/off: arranca o detiene el loop en Rust. */
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await scheduledRecordingService.setEnabled(enabled)
      setSettings((prev) => (prev ? { ...prev, enabled } : prev))
      await reload()
    },
    [reload]
  )

  return { settings, status, isLoading, save, setEnabled, reload }
}
