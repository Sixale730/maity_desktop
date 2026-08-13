/**
 * Heartbeat de salud — telemetría periódica a `maity.platform_logs`.
 *
 * Cada tick invoca `get_health_snapshot` (Rust: memoria por proceso del
 * mem_sampler, fase de grabación y lag de transcripción en UNA llamada IPC)
 * y lo manda como evento `health.heartbeat` vía platformLogger. Con esto una
 * fuga de RAM como la de jul-2026 se ve como serie de tiempo en la DB sin
 * pedirle el export de logs a nadie.
 *
 * Diseño:
 * - Un solo interval base de 5 min; la cadencia real la decide
 *   `shouldEmitHeartbeat` por TIMESTAMPS (5 min activo / 15 min idle). Tras un
 *   sleep del laptop el primer tick ve un elapsed enorme y emite UNA vez —
 *   nunca ráfaga de recuperación.
 * - Ticks extra en recording-start/stop (saltan cadencia, empujan lastEmitAt).
 * - Listener persistente de `transcription-lag-update` cacheando el último
 *   payload: el worker solo emite durante grabación, así el heartbeat de stop
 *   sale con los valores finales de la cola.
 * - Gate de sesión Supabase por tick: sin login, cero RPCs.
 * - Fire-and-forget total: la telemetría jamás rompe la app. Sin `logger.*` ni
 *   `console.*` en el path de envío (evita bucles con errorTelemetry).
 */
import { invoke } from '@tauri-apps/api/core'
import { createSubscriptionGroup } from '@/lib/tauriSubscribe'

import { platformLogger } from '@/lib/platformLogger'
import { supabase } from '@/lib/supabase'
import { TauriEvent } from '@/lib/tauri-events'

export const HEARTBEAT_TICK_MS = 5 * 60_000
export const ACTIVE_EMIT_EVERY_MS = 5 * 60_000
export const IDLE_EMIT_EVERY_MS = 15 * 60_000
/** Jitter del interval: un tick a los 4:59.9 no debe saltarse. */
export const HEARTBEAT_TOLERANCE_MS = 5_000

export type HeartbeatReason = 'initial' | 'interval' | 'recording-start' | 'recording-stop'

/** Espejo de `MemSample` (Rust, logging/mem_sampler.rs). */
interface MemSample {
  app_rss_mb: number
  llama_rss_mb: number
  llama_procs: number
  webview_rss_mb: number
  webview_procs: number
  ffmpeg_procs: number
  sys_avail_mb: number
  sys_total_mb: number
  cpu_pct: number
}

/** Espejo de `SessionPeaks` (Rust). Ojo: el ciclo del coach los resetea. */
interface SessionPeaks {
  app_rss_peak_mb: number
  llama_rss_peak_mb: number
  webview_rss_peak_mb: number
  sys_avail_min_mb: number
  llama_procs_max: number
}

/** Espejo de `HealthSnapshot` (Rust, logging/commands.rs). */
interface HealthSnapshot {
  mem: MemSample | null
  /** null = fallback fresco pre-primer-tick del sampler (cpu_pct sale 0). */
  mem_sample_age_s: number | null
  peaks: SessionPeaks
  phase: string
  lag_seconds: number
}

/** Payload completo de `transcription-lag-update` (worker.rs emite 6 campos). */
interface TranscriptionLagPayload {
  queue_depth: number
  lag_seconds: number
  chunks_per_second: number
  chunks_received: number
  chunks_processed: number
  chunks_dropped: number
}

/**
 * Decide si un tick de interval emite. Pura para tests. `phase` es la fase de
 * Rust (`idle|starting|recording|paused|stopping`): todo lo que no es idle
 * cuenta como activo.
 */
export function shouldEmitHeartbeat(phase: string, msSinceLastEmit: number): boolean {
  const active = phase !== 'idle'
  const emitEvery = active ? ACTIVE_EMIT_EVERY_MS : IDLE_EMIT_EVERY_MS
  return msSinceLastEmit >= emitEvery - HEARTBEAT_TOLERANCE_MS
}

class HealthHeartbeatService {
  private active = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private subs: ReturnType<typeof createSubscriptionGroup> | null = null
  private lastLagPayload: TranscriptionLagPayload | null = null
  /** No se resetean en start(): un remount (StrictMode) no reinicia la sesión. */
  private startedAt = 0
  private lastEmitAt = 0
  private seq = 0

  async start(): Promise<void> {
    if (this.active) return
    this.active = true
    if (this.startedAt === 0) this.startedAt = Date.now()

    this.intervalId = setInterval(() => {
      void this.tick('interval')
    }, HEARTBEAT_TICK_MS)
    void this.tick('initial')

    // El grupo cubre la carrera start/stop: un listen() que resuelve despues de
    // stop() se libera solo, en vez de quedar vivo sin dueño (#65).
    const subs = createSubscriptionGroup()
    this.subs = subs
    subs.on<TranscriptionLagPayload>(TauriEvent.TRANSCRIPTION_LAG_UPDATE, (event) => {
      this.lastLagPayload = event.payload
    })
    subs.on(TauriEvent.RECORDING_STARTED, () => {
      void this.tick('recording-start')
    })
    subs.on(TauriEvent.RECORDING_STOPPED, () => {
      void this.tick('recording-stop')
    })
  }

  stop(): void {
    this.active = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.subs?.dispose()
    this.subs = null
    this.lastLagPayload = null
  }

  private async tick(reason: HeartbeatReason): Promise<void> {
    try {
      if (!this.active) return

      // Sin sesión no hay a quién atribuir el evento: return mudo, cero RPCs.
      const { data } = await supabase.auth.getSession()
      if (!data.session?.user) return

      const snapshot = await invoke<HealthSnapshot>('get_health_snapshot')
      if (!this.active) return
      if (reason === 'interval' && !shouldEmitHeartbeat(snapshot.phase, Date.now() - this.lastEmitAt)) {
        return
      }

      this.lastEmitAt = Date.now()
      this.seq += 1
      const queue = this.lastLagPayload ? { ...this.lastLagPayload } : null
      if (reason === 'recording-stop') {
        // Emitimos con los valores finales de la cola y LUEGO limpiamos.
        this.lastLagPayload = null
      }

      void platformLogger.log('health.heartbeat', {
        reason,
        phase: snapshot.phase,
        uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
        seq: this.seq,
        mem: snapshot.mem,
        mem_sample_age_s: snapshot.mem_sample_age_s,
        peaks: snapshot.peaks,
        lag_seconds: snapshot.lag_seconds,
        queue,
      })
    } catch {
      // Fire-and-forget: un fallo de snapshot/red no debe tocar la app.
    }
  }
}

export const healthHeartbeatService = new HealthHeartbeatService()
