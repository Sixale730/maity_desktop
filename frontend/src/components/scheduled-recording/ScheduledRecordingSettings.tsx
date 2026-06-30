'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useScheduledRecording } from '@/hooks/useScheduledRecording'
import {
  scheduledRecordingService,
  defaultWindow,
  type ScheduleWindow,
  type SchedulerPhase,
} from '@/services/scheduledRecordingService'

// 1=Lunes .. 7=Domingo (mapea a chrono::Weekday::number_from_monday()).
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'X' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 7, label: 'D' },
]

const PHASE_LABEL: Record<SchedulerPhase, string> = {
  disabled: 'Desactivado',
  idle: 'En espera',
  armed: 'Listo (dentro de horario)',
  recording: 'Grabando jornada',
  grace: 'Periodo de gracia',
  stopping: 'Deteniendo',
}

function formatNextFire(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ScheduledRecordingSettings() {
  const { settings, status, isLoading, save, setEnabled, reload, markConfigured } = useScheduledRecording()
  const [isSaving, setIsSaving] = useState(false)

  // Editamos una única ventana (windows[0]) — el backend soporta varias, pero la UI
  // v1 expone una "jornada". Estado local editable + guardado explícito.
  const [draft, setDraft] = useState<ScheduleWindow>(defaultWindow())
  const [grace, setGrace] = useState(30)
  const [notify, setNotify] = useState(true)
  const [respectManual, setRespectManual] = useState(true)

  useEffect(() => {
    if (!settings) return
    setDraft(settings.windows[0] ?? defaultWindow())
    setGrace(settings.grace_period_minutes)
    setNotify(settings.notify_on_start)
    setRespectManual(settings.respect_manual_recording)
  }, [settings])

  const toggleDay = (day: number) => {
    setDraft((prev) => {
      const has = prev.days_of_week.includes(day)
      const days = has
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day].sort((a, b) => a - b)
      return { ...prev, days_of_week: days }
    })
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    setIsSaving(true)
    try {
      await setEnabled(enabled)
      await markConfigured()
      toast.success(enabled ? 'Grabación por jornada activada' : 'Grabación por jornada desactivada')
    } catch (error) {
      console.error('[ScheduledRecordingSettings] Failed to toggle:', error)
      toast.error('Error al cambiar el estado de la grabación programada')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async () => {
    if (!settings) return
    if (draft.days_of_week.length === 0) {
      toast.error('Selecciona al menos un día de la semana')
      return
    }
    setIsSaving(true)
    try {
      await save({
        ...settings,
        windows: [draft],
        grace_period_minutes: Number.isFinite(grace) ? Math.max(0, grace) : 30,
        notify_on_start: notify,
        respect_manual_recording: respectManual,
        configured_by_user: true,
      })
      toast.success('Horario de jornada guardado')
      await reload()
    } catch (error) {
      console.error('[ScheduledRecordingSettings] Failed to save:', error)
      toast.error('Error al guardar el horario')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCheckNow = async () => {
    try {
      await scheduledRecordingService.checkNow()
      toast.info('Evaluación de horario solicitada')
      await reload()
    } catch (error) {
      console.error('[ScheduledRecordingSettings] checkNow failed:', error)
    }
  }

  const phaseLabel = useMemo(
    () => (status ? PHASE_LABEL[status.phase] ?? status.phase : '—'),
    [status]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No se pudo cargar la configuración de grabación programada
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Grabación programada por jornada</h3>
        </div>
        <Button variant="outline" size="sm" onClick={handleCheckNow} disabled={!settings.enabled || isSaving}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Evaluar ahora
        </Button>
      </div>

      {/* Main toggle */}
      <div className="flex items-center justify-between p-4 bg-muted/40 border border-border rounded-lg">
        <div>
          <p className="font-medium text-foreground">Grabar automáticamente en mi horario</p>
          <p className="text-sm text-muted-foreground">
            Maity inicia y detiene la grabación sola durante la ventana que definas (funciona con la
            ventana minimizada en la bandeja).
          </p>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={handleToggleEnabled} disabled={isSaving} />
      </div>

      {settings.enabled && (
        <>
          {/* Días de la semana */}
          <div className="space-y-2">
            <Label className="text-foreground">Días</Label>
            <div className="flex gap-2">
              {DAYS.map((d) => {
                const active = draft.days_of_week.includes(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`h-9 w-9 rounded-full text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Horario */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sched-start" className="text-foreground">Hora de inicio</Label>
              <Input
                id="sched-start"
                type="time"
                value={draft.start_time}
                onChange={(e) => setDraft((p) => ({ ...p, start_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sched-end" className="text-foreground">Hora de fin</Label>
              <Input
                id="sched-end"
                type="time"
                value={draft.end_time}
                onChange={(e) => setDraft((p) => ({ ...p, end_time: e.target.value }))}
              />
            </div>
          </div>
          {draft.end_time <= draft.start_time && (
            <p className="text-xs text-amber-500">
              La hora de fin es menor o igual a la de inicio: la jornada cruzará la medianoche.
            </p>
          )}

          {/* Periodo de gracia */}
          <div className="space-y-2">
            <Label htmlFor="sched-grace" className="text-foreground">Periodo de gracia (minutos)</Label>
            <Input
              id="sched-grace"
              type="number"
              min={0}
              value={grace}
              onChange={(e) => setGrace(parseInt(e.target.value, 10))}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Si al terminar el horario sigue una reunión abierta, Maity espera hasta este margen
              antes de detener la grabación.
            </p>
          </div>

          {/* Opciones */}
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <div>
              <p className="font-medium text-foreground">Avisar al iniciar</p>
              <p className="text-sm text-muted-foreground">Mostrar una notificación cuando arranque la jornada.</p>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <div>
              <p className="font-medium text-foreground">Respetar grabación manual</p>
              <p className="text-sm text-muted-foreground">
                Si ya estás grabando a mano, no interrumpir ni iniciar otra.
              </p>
            </div>
            <Switch checked={respectManual} onCheckedChange={setRespectManual} />
          </div>

          {/* Estado + guardar */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className={`w-2 h-2 rounded-full ${
                  status?.phase === 'recording' || status?.phase === 'grace'
                    ? 'bg-green-500'
                    : status?.running
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/40'
                }`}
              />
              <span>{phaseLabel}</span>
              {status?.next_fire_at && (
                <span className="text-muted-foreground/70">· Próxima: {formatNextFire(status.next_fire_at)}</span>
              )}
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar horario
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default ScheduledRecordingSettings
