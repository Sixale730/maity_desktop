'use client'

import React, { useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { defaultWindow, type ScheduleWindow } from '@/services/scheduledRecordingService'

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

interface ScheduledRecordingSetupCardProps {
  /** Llamado al activar; recibe la ventana elegida. Debe persistir y arrancar el loop. */
  onActivate: (window: ScheduleWindow) => Promise<void> | void
  /** Si se provee, muestra un "Ahora no" que cierra sin activar. Omitir ⇒ obligatorio. */
  onDismiss?: () => Promise<void> | void
  /** Ventana inicial (default: Lun-Vie 09:00-18:00). */
  initialWindow?: ScheduleWindow
}

/**
 * Tarjeta presentacional para configurar y ACTIVAR la grabación por jornada.
 * Reutilizada por el gate del onboarding y el modal post-actualización.
 * (Intencionalmente NO menciona que se puede desactivar después.)
 */
export function ScheduledRecordingSetupCard({
  onActivate,
  onDismiss,
  initialWindow,
}: ScheduledRecordingSetupCardProps) {
  const [draft, setDraft] = useState<ScheduleWindow>(initialWindow ?? defaultWindow())
  const [busy, setBusy] = useState(false)

  const toggleDay = (day: number) => {
    setDraft((prev) => {
      const has = prev.days_of_week.includes(day)
      const days = has
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day].sort((a, b) => a - b)
      return { ...prev, days_of_week: days }
    })
  }

  const noDays = draft.days_of_week.length === 0

  const handleActivate = async () => {
    if (noDays || busy) return
    setBusy(true)
    try {
      await onActivate(draft)
    } finally {
      setBusy(false)
    }
  }

  const handleDismiss = async () => {
    if (busy || !onDismiss) return
    setBusy(true)
    try {
      await onDismiss()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
          <CalendarClock className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Grabación automática por jornada</h2>
          <p className="text-sm text-muted-foreground">
            Maity grabará tus reuniones durante tu horario, sin que tengas que iniciarlo a mano.
          </p>
        </div>
      </div>

      {/* Días */}
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
                className={`h-10 w-10 rounded-full text-sm font-medium transition-colors ${
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
          <Label htmlFor="setup-start" className="text-foreground">Hora de inicio</Label>
          <Input
            id="setup-start"
            type="time"
            value={draft.start_time}
            onChange={(e) => setDraft((p) => ({ ...p, start_time: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-end" className="text-foreground">Hora de fin</Label>
          <Input
            id="setup-end"
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

      {/* Acciones */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Button
          onClick={handleActivate}
          disabled={busy || noDays}
          className="w-full h-11 text-base font-medium"
        >
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Activar grabación por jornada
        </Button>
        {noDays && (
          <p className="text-xs text-amber-500">Selecciona al menos un día.</p>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={handleDismiss}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Ahora no
          </button>
        )}
      </div>
    </div>
  )
}

export default ScheduledRecordingSetupCard
