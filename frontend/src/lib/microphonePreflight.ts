import { invoke } from '@tauri-apps/api/core'
import type { AudioDeviceErrorPayload } from '@/lib/tauri-events'
import { logger } from '@/lib/logger'

/**
 * Preflight honesto de micrófono.
 *
 * `null` = el micrófono está listo. Si no, el payload clasificado (mismo shape
 * que el evento `audio-device-error`, así que la UI reusa la misma remediación).
 *
 * **Por qué no vale contar dispositivos.** En Windows la enumeración NO está
 * bloqueada por la privacidad del SO: lista el micrófono y es
 * `IAudioClient::Initialize` quien devuelve `E_ACCESSDENIED` después. Un chequeo
 * por conteo — lo que hace `usePermissionCheck` — reporta OK justo en el caso que
 * más importa detectar. En el piloto Dingler eso dejó a una usuaria con cero
 * grabaciones sin una sola pista de por qué.
 *
 * **Cuándo llamarla.** Sólo desde pantallas de configuración/diagnóstico y
 * siempre disparada por el usuario. NUNCA en un intervalo ni al montar la app:
 * abre un stream de captura real (~500 ms), así que ponerla en el poll de 5 s de
 * `usePermissionCheck` cambiaría una tormenta de telemetría por una de audio, y
 * podría pelearse con una grabación en curso.
 */
export async function checkMicrophoneReady(): Promise<AudioDeviceErrorPayload | null> {
  try {
    return await invoke<AudioDeviceErrorPayload | null>('check_microphone_ready')
  } catch (error) {
    // Que falle el diagnóstico no es lo mismo que un micrófono roto: se reporta
    // como desconocido y la UI no acusa a nadie.
    logger.warn('[microphonePreflight] no se pudo comprobar el micrófono', error)
    return null
  }
}

/** Abre Configuración → Privacidad → Micrófono del SO. */
export async function openMicrophonePrivacySettings(): Promise<void> {
  await invoke('open_microphone_privacy_settings')
}
