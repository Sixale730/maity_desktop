import type { TranscriptModelProps } from '@/types/transcript';

export type TranscriptionProvider = TranscriptModelProps['provider'];

/**
 * Proveedor asumido cuando la configuración todavía no resolvió.
 *
 * Era `'deepgram'`, y eso era un fail-open con dos filos:
 *
 * 1. Deepgram está deprecado en este proyecto (jun-2026). Asumirlo como default
 *    apunta la validación de arranque a un proveedor que ya no es el camino real.
 * 2. La rama Deepgram de `checkTranscriptionReady` puede devolver `ready: true`
 *    desde una proxy config cacheada — es decir, la app autorizaba grabar
 *    validando un proveedor que NO iba a transcribir. Con Parakeet ausente eso
 *    produce una grabación sin transcripts, que es como se perdieron reuniones
 *    completas en el piloto de Dingler (ago-2026).
 *
 * Parakeet es el único motor de transcripción de usuario: Whisper, Moonshine y
 * Canary existen solo para desarrollo y **no hay fallback entre motores**. El
 * default tiene que apuntar al motor que realmente va a correr.
 *
 * Regla asociada: ausencia de configuración NO es lo mismo que "usa el default".
 * Los llamadores que validan readiness deben tratar `transcriptModelConfig`
 * nulo como "todavía no sé" y fallar cerrado, no adoptar este valor.
 */
export const DEFAULT_TRANSCRIPTION_PROVIDER: TranscriptionProvider = 'parakeet';
