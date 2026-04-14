/**
 * useTranscriptionBackpressureIndicator
 *
 * B.3 — Consumes the Rust events `transcription-backpressure` (emitted on
 * each drop) and `transcription-lag-warning` (emitted in the 1000–1500 queue
 * depth watermark) and shows visible feedback to the user via toast.
 * Also listens for circuit-breaker state events (B.1).
 *
 * Mount once at app root (layout.tsx) so the toasts surface regardless of
 * which route the user is on during a recording.
 */
import { useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

interface BackpressurePayload {
  dropped_now?: number
  dropped_total?: number
  queue_depth?: number
  recording_seconds_affected?: number
}

interface LagWarningPayload {
  queue_depth?: number
  threshold_drop?: number
  capacity?: number
}

interface CircuitPayload {
  reason?: string
  failure_count?: number
  open_for_secs?: number
  previous_state?: string
}

export function useTranscriptionBackpressureIndicator(): void {
  useEffect(() => {
    const unlistens: UnlistenFn[] = []

    const run = async () => {
      // Chunks actively dropped — the most severe signal. Persistent toast.
      unlistens.push(
        await listen<BackpressurePayload>('transcription-backpressure', (event) => {
          const payload = event.payload ?? {}
          const seconds = payload.recording_seconds_affected?.toFixed(1) ?? '?'
          const total = payload.dropped_total ?? '?'
          toast.error('Transcripción atrasada: parte del audio no será transcrita', {
            description: `~${seconds}s de audio afectado · total descartado: ${total}`,
            duration: 8000,
          })
        })
      )

      // Lag warning zone — queue is filling up but no drops yet. Soft toast.
      // Rate-limit to once per 15s per renderer to avoid toast spam: we keep
      // a local timestamp since the Rust side already gates at every 100
      // pending chunks but the UI needs a harder cap.
      let lastLagToastAt = 0
      unlistens.push(
        await listen<LagWarningPayload>('transcription-lag-warning', (event) => {
          const now = Date.now()
          if (now - lastLagToastAt < 15_000) return
          lastLagToastAt = now
          const depth = event.payload?.queue_depth ?? '?'
          toast.warning('Transcripción acercándose a su límite', {
            description: `Cola de procesamiento: ${depth} chunks pendientes`,
            duration: 5000,
          })
        })
      )

      // Circuit breaker opened — engine is malfunctioning. Show once.
      unlistens.push(
        await listen<CircuitPayload>('transcription-circuit-open', (event) => {
          const secs = event.payload?.open_for_secs ?? 60
          toast.error('Motor de transcripción en pausa de recuperación', {
            description: `Reintentando automáticamente en ~${secs}s. La grabación continúa.`,
            duration: 10000,
          })
        })
      )

      unlistens.push(
        await listen<CircuitPayload>('transcription-circuit-closed', () => {
          toast.success('Transcripción recuperada', { duration: 4000 })
        })
      )
    }

    run()

    return () => {
      unlistens.forEach((fn) => fn())
    }
  }, [])
}
