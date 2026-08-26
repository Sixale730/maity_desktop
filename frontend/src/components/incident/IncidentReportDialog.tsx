'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { LifeBuoy, Loader2, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TauriEvent } from '@/lib/tauri-events'
import { subscribeTauriEvent } from '@/lib/tauriSubscribe'
import { logger } from '@/lib/logger'

/**
 * "¿Enviar diagnóstico a Maity?" — bundle de incidente con consentimiento (#61).
 *
 * Es la ÚNICA superficie desde la que un log sale de la máquina, y solo con
 * el "Enviar" explícito del usuario. Rust (`logging/incident.rs`) decide CUÁNDO
 * preguntar (umbral de RAM sostenido, panic del arranque anterior; con dedupe
 * por proceso + cooldown de 7 días + "no volver a preguntar") y QUÉ se sube
 * (~200 KB de tail del log + cabecera + system_info; sin audio ni transcripciones).
 *
 * Fuentes del incidente, en orden de robustez:
 * 1. Pull `take_pending_incident` al montar y en `visibilitychange` — WebView2
 *    suspende el JS con la ventana oculta (tray/jornada) y el push se pierde.
 * 2. Push `incident-detected` (evento Tauri) para la ventana visible.
 * 3. DOM `open-incident-dialog` con `kind:'manual'` (botón en Ajustes) — bus
 *    DOM, no Tauri, porque es intra-ventana. El manual ignora `never_ask`.
 */

export type IncidentKind = 'app-rss-critical' | 'system-memory-pressure' | 'rust-panic' | 'manual'

export interface IncidentPayload {
  kind: IncidentKind
  ts_ms: number
  message: string
  detail?: unknown
}

interface IncidentPrefs {
  never_ask: boolean
  last_prompt_ms: Record<string, number>
}

export const OPEN_INCIDENT_DIALOG_EVENT = 'open-incident-dialog'

/** Abre el diálogo en modo manual (Ajustes → Diagnóstico y Soporte). */
export function requestManualIncidentDialog(): void {
  window.dispatchEvent(
    new CustomEvent<IncidentPayload>(OPEN_INCIDENT_DIALOG_EVENT, {
      detail: { kind: 'manual', ts_ms: Date.now(), message: 'Solicitado por el usuario' },
    }),
  )
}

const COPY: Record<IncidentKind, { title: string; body: string }> = {
  'app-rss-critical': {
    title: 'Maity está usando mucha memoria',
    body: 'Detectamos que Maity superó un umbral crítico de RAM. Un diagnóstico nos ayuda a encontrar la causa y corregirla.',
  },
  'system-memory-pressure': {
    title: 'Tu equipo se quedó casi sin memoria',
    body: 'El sistema lleva un rato con muy poca memoria disponible. Un diagnóstico nos permite ver si Maity contribuyó y cómo evitarlo.',
  },
  'rust-panic': {
    title: 'Maity se cerró inesperadamente',
    body: 'La última vez Maity terminó con un error interno. Un diagnóstico nos ayuda a entender qué pasó.',
  },
  manual: {
    title: 'Enviar diagnóstico a Maity',
    body: 'Envía un diagnóstico técnico al equipo de Maity para que soporte pueda revisar un problema.',
  },
}

function isKind(value: unknown): value is IncidentKind {
  return (
    value === 'app-rss-critical' ||
    value === 'system-memory-pressure' ||
    value === 'rust-panic' ||
    value === 'manual'
  )
}

export function IncidentReportDialog() {
  const [incident, setIncident] = useState<IncidentPayload | null>(null)
  const [sending, setSending] = useState(false)
  const [neverAsk, setNeverAsk] = useState(false)
  const prefsRef = useRef<IncidentPrefs>({ never_ask: false, last_prompt_ms: {} })
  // Evita que un pull tardío pise un diálogo ya abierto/enviado.
  const incidentRef = useRef<IncidentPayload | null>(null)
  incidentRef.current = incident

  const present = useCallback((payload: IncidentPayload | null | undefined) => {
    if (!payload || !isKind(payload.kind)) return
    // Rust ya respeta never_ask al armar; se repite aquí por si el pull llega
    // desde un slot armado antes de que el usuario marcara la casilla.
    if (payload.kind !== 'manual' && prefsRef.current.never_ask) return
    if (incidentRef.current) return
    setIncident(payload)
  }, [])

  const pull = useCallback(async () => {
    try {
      const pending = await invoke<IncidentPayload | null>('take_pending_incident')
      present(pending)
    } catch (err) {
      logger.warn('[incident] take_pending_incident falló:', err)
    }
  }, [present])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const prefs = await invoke<IncidentPrefs>('get_incident_preferences')
        if (!cancelled && prefs) {
          prefsRef.current = prefs
          setNeverAsk(!!prefs.never_ask)
        }
      } catch (err) {
        logger.warn('[incident] get_incident_preferences falló:', err)
      }
      if (!cancelled) await pull()
    })()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void pull()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onManual = (e: Event) => {
      const detail = (e as CustomEvent<IncidentPayload>).detail
      present(detail ?? { kind: 'manual', ts_ms: Date.now(), message: 'Solicitado por el usuario' })
    }
    window.addEventListener(OPEN_INCIDENT_DIALOG_EVENT, onManual)

    const unsubscribe = subscribeTauriEvent<IncidentPayload>(TauriEvent.INCIDENT_DETECTED, (e) => {
      present(e.payload)
    })

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(OPEN_INCIDENT_DIALOG_EVENT, onManual)
      unsubscribe()
    }
  }, [present, pull])

  const persistNeverAsk = useCallback(async () => {
    if (neverAsk === prefsRef.current.never_ask) return
    const next: IncidentPrefs = { ...prefsRef.current, never_ask: neverAsk }
    try {
      await invoke('set_incident_preferences', { preferences: next })
      prefsRef.current = next
    } catch (err) {
      logger.warn('[incident] set_incident_preferences falló:', err)
    }
  }, [neverAsk])

  const close = useCallback(async () => {
    await persistNeverAsk()
    setIncident(null)
  }, [persistNeverAsk])

  const handleSend = useCallback(async () => {
    if (!incident || sending) return
    setSending(true)
    try {
      const path = await invoke<string>('upload_incident_bundle', { kind: incident.kind, note: null })
      toast.success('Diagnóstico enviado. Gracias.', { description: path })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error('No se pudo enviar el diagnóstico', { description: message })
    } finally {
      setSending(false)
      await close()
    }
  }, [incident, sending, close])

  if (!incident) return null

  const copy = COPY[incident.kind]
  const automatic = incident.kind !== 'manual'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending) void close()
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="incident-report-dialog" data-kind={incident.kind}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-[#485DF4]" />
            ¿Enviar diagnóstico a Maity?
          </DialogTitle>
          <DialogDescription>
            <span className="block font-medium text-foreground">{copy.title}</span>
            <span className="mt-1 block">{copy.body}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          {automatic && incident.message && (
            <p className="rounded-md bg-secondary px-3 py-2 font-mono text-xs" data-testid="incident-message">
              {incident.message}
            </p>
          )}
          <p>Se envía al equipo de Maity, solo si aceptas:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Los últimos ~200 KB del registro técnico de la app.</li>
            <li>Información del sistema y uso de memoria de Maity.</li>
            <li>Puede incluir nombres de reuniones y dispositivos.</li>
          </ul>
          <p className="font-medium text-foreground">No incluye audio ni transcripciones.</p>
        </div>

        {automatic && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={neverAsk}
              onCheckedChange={(v) => setNeverAsk(v === true)}
              aria-label="No volver a preguntar"
              data-testid="incident-never-ask"
            />
            No volver a preguntar
          </label>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => void close()} disabled={sending}>
            Ahora no
          </Button>
          <Button onClick={handleSend} disabled={sending} data-testid="incident-send">
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Enviar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default IncidentReportDialog
