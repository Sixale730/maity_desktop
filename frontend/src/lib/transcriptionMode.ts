import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export type TranscriptionMode = 'streaming' | 'batch'

/**
 * Subconjunto de `RecordingPreferences` (Rust) que decide el modo. Tipo LOCAL a
 * propósito: este módulo lo consume `OnboardingContext` en el arranque y no
 * debe depender de `types/audio.ts` (ni arrastrar nada más al grafo).
 */
interface PrefsLite {
  transcription_mode?: string
  auto_save?: boolean
}

/**
 * Espejo de la decisión de `recording_helpers.rs` (F3): el lote sólo aplica si
 * la preferencia dice `batch` Y hay guardado de audio — sin `auto_save` no hay
 * checkpoints, así que no hay nada que transcribir después y Rust cae a streaming.
 */
function resolveMode(prefs: PrefsLite | null | undefined): TranscriptionMode {
  if (!prefs) return 'streaming'
  return prefs.transcription_mode === 'batch' && prefs.auto_save !== false ? 'batch' : 'streaming'
}

// Espejo del patrón de `deviceTier.ts`: single-flight y se cachea SÓLO el
// éxito, para que un IPC transitorio no deje pegado un valor equivocado toda
// la sesión. A diferencia del tier, la preferencia SÍ cambia en la sesión
// (Ajustes) — por eso existe `resetTranscriptionModeCache()`, que además
// invalida cualquier lectura en vuelo (generación) para que un resultado viejo
// no pise el cache después del reset.
let cached: TranscriptionMode | null = null
let inFlight: Promise<TranscriptionMode> | null = null
let generation = 0

/**
 * Modo de transcripción EFECTIVO según las preferencias guardadas.
 *
 * Fail-closed a `'streaming'`: si no se pueden leer las preferencias se asume
 * el camino probado (y el que descarga Gemma), nunca el lote.
 */
export async function getTranscriptionMode(): Promise<TranscriptionMode> {
  if (cached) return cached
  if (inFlight) return inFlight
  const myGeneration = generation
  inFlight = invoke<PrefsLite>('get_recording_preferences')
    .then((prefs) => {
      const mode = resolveMode(prefs)
      if (myGeneration === generation) cached = mode
      return mode
    })
    .catch((error) => {
      logger.warn('[transcriptionMode] no se pudieron leer las preferencias; se asume streaming', error)
      return 'streaming' as const
    })
    .finally(() => {
      if (myGeneration === generation) inFlight = null
    })
  return inFlight
}

/** `true` sólo con `transcription_mode === 'batch'` y guardado de audio activo. */
export async function isBatchTranscriptionMode(): Promise<boolean> {
  return (await getTranscriptionMode()) === 'batch'
}

/**
 * Invalida el cache. Llamar tras guardar `set_recording_preferences` (el único
 * escritor es `RecordingSettings.savePreferences`).
 */
export function resetTranscriptionModeCache(): void {
  cached = null
  inFlight = null
  generation += 1
}
