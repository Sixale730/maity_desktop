import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export type PerformanceTier = 'low' | 'medium' | 'high' | 'ultra'

/**
 * Perfil de hardware que expone `get_device_profile` (Rust).
 * Espejo parcial de `logging::commands::DeviceProfile` — sólo lo que consume la UI.
 */
interface DeviceProfileLite {
  performance_tier: PerformanceTier
  memory_gb: number
}

// `HardwareProfile::detect()` cachea en un `OnceLock` de proceso, así que el tier
// no cambia en toda la sesión: una sola llamada, con single-flight para los
// consumidores que montan a la vez.
let cached: DeviceProfileLite | null = null
let inFlight: Promise<DeviceProfileLite | null> | null = null

async function loadProfile(): Promise<DeviceProfileLite | null> {
  if (cached) return cached
  if (inFlight) return inFlight
  inFlight = invoke<DeviceProfileLite>('get_device_profile')
    .then((profile) => {
      cached = profile
      return profile
    })
    .catch((error) => {
      logger.warn('[deviceTier] no se pudo leer el perfil del equipo', error)
      return null
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * ¿Este equipo necesita el modelo de resumen local (Gemma)?
 *
 * `false` en tier Low: ahí el coach usa heurísticos y **nada más consume el
 * sidecar local** (Maity Chat, la minuta y el análisis V4 corren en la nube), así
 * que descargar ~1 GB sería gastar red y disco del equipo que menos lo puede
 * pagar. Ver `coach::should_use_llm_tips` en Rust — es la misma decisión.
 *
 * Ante la duda devuelve `true`: si el perfil no se puede leer, se conserva el
 * comportamiento histórico en vez de saltarse una descarga que quizá hacía falta.
 */
export async function needsSummaryModel(): Promise<boolean> {
  const profile = await loadProfile()
  return profile?.performance_tier !== 'low'
}
