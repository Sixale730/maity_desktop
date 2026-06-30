/**
 * Cliente TS para la grabación programada por jornada.
 *
 * NOTA de interop Tauri: los nombres de argumento de comando se convierten
 * camelCase↔snake_case, pero los campos anidados del struct van por serde tal cual,
 * por eso las interfaces usan snake_case (deben calzar con el `#[derive(Deserialize)]`).
 */
import { invoke } from '@tauri-apps/api/core'

export interface ScheduleWindow {
  /** 1=Lunes .. 7=Domingo */
  days_of_week: number[]
  /** "HH:MM" 24h, hora local */
  start_time: string
  /** "HH:MM" 24h; si end <= start, cruza medianoche */
  end_time: string
}

export interface ScheduledRecordingSettings {
  enabled: boolean
  windows: ScheduleWindow[]
  grace_period_minutes: number
  respect_manual_recording: boolean
  catch_up_on_start: boolean
  check_interval_seconds: number
  notify_on_start: boolean
  meeting_name_template: string
}

export type SchedulerPhase =
  | 'disabled'
  | 'idle'
  | 'armed'
  | 'recording'
  | 'grace'
  | 'stopping'

export interface ScheduledStatus {
  phase: SchedulerPhase
  running: boolean
  enabled: boolean
  in_window: boolean
  next_fire_at: string | null
}

export const scheduledRecordingService = {
  getSettings: () =>
    invoke<ScheduledRecordingSettings>('get_scheduled_recording_settings'),

  setSettings: (settings: ScheduledRecordingSettings) =>
    invoke<void>('set_scheduled_recording_settings', { settings }),

  setEnabled: (enabled: boolean) =>
    invoke<void>('set_scheduled_recording_enabled', { enabled }),

  getStatus: () => invoke<ScheduledStatus>('get_scheduled_recording_status'),

  isRunning: () =>
    invoke<boolean>('is_scheduled_recording_service_running'),

  checkNow: () => invoke<void>('check_schedule_now'),
}

/** Plantilla de una ventana laboral por defecto (Lun-Vie 09:00-18:00). */
export function defaultWindow(): ScheduleWindow {
  return { days_of_week: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '18:00' }
}
