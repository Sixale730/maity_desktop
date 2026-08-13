import { useEffect } from 'react'
import { createSubscriptionGroup } from '@/lib/tauriSubscribe'
import { platformLogger } from '@/lib/platformLogger'
import { TauriEvent } from '@/lib/tauri-events'

interface CoachSessionSummary {
  llm_parse_total?: number
  llm_parse_failed?: number
  llm_parse_failed_pct?: number
  llm_latency_p95_ms?: number | null
  tips_from_llm?: number
  tips_from_heuristic?: number
  heuristic_pct?: number
  sidecar_timeouts?: number
  sidecar_restarts?: number
  sidecar_cooldowns?: number
  breaker_opens?: number
}

interface CoachMetricsPayload {
  session_summary?: CoachSessionSummary
  ttfb_first_tip_ms?: number
}

/**
 * Escucha `coach-metrics` de Rust y reenvía el session-summary del coach
 * (métricas LLM + supervisión del sidecar: timeouts, restarts, cooldowns,
 * aperturas del breaker) a Supabase `maity.platform_logs` vía platformLogger.
 *
 * Sin este listener las métricas morían en el log local: el evento se emitía
 * pero nadie lo escuchaba. Se usa `platformLogger.log` directo (mismo destino
 * que `Analytics.track`, que es un wrapper no-op de PostHog y tipa las
 * properties como strings; el summary trae números).
 *
 * Los payloads sin `session_summary` (p. ej. `ttfb_first_tip_ms` durante la
 * sesión) se ignoran aquí — son diagnóstico de log local, no telemetría.
 *
 * Montar una sola vez en el root de la app.
 */
export function useCoachMetricsTelemetry(): void {
  useEffect(() => {
    const subs = createSubscriptionGroup()

    const subscribe = async () => {
      subs.on<CoachMetricsPayload>(TauriEvent.COACH_METRICS, (event) => {
        const summary = event.payload?.session_summary
        if (!summary) return
        void platformLogger.log('coach.session_summary', { ...summary })
      })
    }

    subscribe()

    return () => {
      subs.dispose()
    }
  }, [])
}
