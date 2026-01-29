'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Video, Settings, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface MonitoredAppStatus {
  id: string
  name: string
  enabled: boolean
  action: string // "always_ask", "auto_record", "ignore"
}

interface MeetingDetectorSettings {
  enabled: boolean
  auto_record: boolean
  auto_record_delay_seconds: number
  show_detection_notification: boolean
  check_interval_seconds: number
  remember_choices: boolean
}

export function MeetingDetectorSettings() {
  const [settings, setSettings] = useState<MeetingDetectorSettings | null>(null)
  const [apps, setApps] = useState<MonitoredAppStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDetectorRunning, setIsDetectorRunning] = useState(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    loadAppsStatus()
    checkDetectorStatus()
  }, [])

  const loadSettings = async () => {
    try {
      const result = await invoke<MeetingDetectorSettings>('get_meeting_detector_settings')
      setSettings(result)
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to load settings:', error)
      toast.error('Error al cargar configuración de detección')
    } finally {
      setIsLoading(false)
    }
  }

  const loadAppsStatus = async () => {
    try {
      const result = await invoke<MonitoredAppStatus[]>('get_monitored_apps_status')
      setApps(result)
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to load apps status:', error)
    }
  }

  const checkDetectorStatus = async () => {
    try {
      const running = await invoke<boolean>('is_meeting_detector_running')
      setIsDetectorRunning(running)
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to check detector status:', error)
    }
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!settings) return
    setIsSaving(true)
    try {
      await invoke('set_meeting_detector_enabled', { enabled })
      setSettings({ ...settings, enabled })

      if (enabled && !isDetectorRunning) {
        await invoke('start_meeting_detector')
        setIsDetectorRunning(true)
        toast.success('Detector de reuniones activado')
      } else if (!enabled && isDetectorRunning) {
        await invoke('stop_meeting_detector')
        setIsDetectorRunning(false)
        toast.success('Detector de reuniones desactivado')
      }
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to toggle detector:', error)
      toast.error('Error al cambiar estado del detector')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleAutoRecord = async (autoRecord: boolean) => {
    if (!settings) return
    setIsSaving(true)
    try {
      await invoke('set_meeting_auto_record', { enabled: autoRecord })
      setSettings({ ...settings, auto_record: autoRecord })
      toast.success(autoRecord ? 'Grabación automática activada' : 'Grabación automática desactivada')
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to toggle auto-record:', error)
      toast.error('Error al cambiar grabación automática')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleApp = async (appId: string, enabled: boolean) => {
    setIsSaving(true)
    try {
      await invoke('set_meeting_app_monitoring', {
        meetingApp: appId,
        enabled,
      })

      setApps(apps.map(app =>
        app.id === appId ? { ...app, enabled } : app
      ))
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to toggle app:', error)
      toast.error('Error al cambiar monitoreo de aplicación')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChangeAppAction = async (appId: string, action: string) => {
    setIsSaving(true)
    try {
      await invoke('set_meeting_app_action', {
        meetingApp: appId,
        action,
      })

      setApps(apps.map(app =>
        app.id === appId ? { ...app, action } : app
      ))
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to change app action:', error)
      toast.error('Error al cambiar acción de aplicación')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCheckNow = async () => {
    try {
      const meetings = await invoke<any[]>('check_for_meetings_now')
      if (meetings.length === 0) {
        toast.info('No se detectaron reuniones activas')
      } else {
        toast.success(`Se detectaron ${meetings.length} reunión(es)`)
      }
    } catch (error) {
      console.error('[MeetingDetectorSettings] Failed to check for meetings:', error)
      toast.error('Error al buscar reuniones')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-4 text-center text-gray-500">
        No se pudo cargar la configuración
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Detección de Reuniones</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckNow}
          disabled={!settings.enabled || isSaving}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Buscar ahora
        </Button>
      </div>

      {/* Main toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="font-medium">Detección automática</p>
          <p className="text-sm text-gray-500">
            Detectar cuando se abren aplicaciones de reuniones
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={isSaving}
        />
      </div>

      {settings.enabled && (
        <>
          {/* Auto-record toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium">Grabación automática</p>
              <p className="text-sm text-gray-500">
                Iniciar grabación automáticamente (con cuenta regresiva de 5 segundos)
              </p>
            </div>
            <Switch
              checked={settings.auto_record}
              onCheckedChange={handleToggleAutoRecord}
              disabled={isSaving}
            />
          </div>

          {/* Apps list */}
          <div className="space-y-3">
            <h4 className="font-medium text-gray-700">Aplicaciones monitoreadas</h4>
            <div className="space-y-2">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={app.enabled}
                      onCheckedChange={(enabled) => handleToggleApp(app.id, enabled)}
                      disabled={isSaving}
                    />
                    <span className={app.enabled ? 'text-gray-900' : 'text-gray-400'}>
                      {app.name}
                    </span>
                  </div>

                  {app.enabled && (
                    <Select
                      value={app.action}
                      onValueChange={(value) => handleChangeAppAction(app.id, value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="always_ask">Preguntar</SelectItem>
                        <SelectItem value="auto_record">Auto-grabar</SelectItem>
                        <SelectItem value="ignore">Ignorar</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            <div
              className={`w-2 h-2 rounded-full ${
                isDetectorRunning ? 'bg-green-500' : 'bg-gray-300'
              }`}
            />
            <span className="text-sm text-gray-600">
              {isDetectorRunning
                ? 'Detector activo - verificando cada 5 segundos'
                : 'Detector inactivo'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default MeetingDetectorSettings
