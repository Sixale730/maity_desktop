import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createSubscriptionGroup } from '@/lib/tauriSubscribe'
import { toast } from 'sonner'
import { TauriEvent } from '@/lib/tauri-events'
import type { AudioDeviceErrorPayload } from '@/lib/tauri-events'
import { logger } from '@/lib/logger'

interface MicrophoneFallbackPayload {
  requested?: string
  actual?: string
  reason?: 'not_found' | 'invalid_format' | string
}

interface MicLoopbackPayload {
  device?: string
}

interface MicSilencePayload {
  device?: string | null
  silenceSecs?: number
  mode?: 'silent' | 'stalled' | string
}

interface BluetoothMicAvoidedPayload {
  outputDevice?: string
  bluetoothMic?: string
  substituteMic?: string | null
  applied?: boolean
}

function describeReason(reason?: string): string {
  switch (reason) {
    case 'not_found':
      return 'no está conectado en este momento'
    case 'invalid_format':
      return 'tiene un formato inválido en preferencias'
    default:
      return 'no está disponible'
  }
}

/**
 * Listens for `microphone-fallback` events from Rust and surfaces a toast
 * when the user's preferred microphone could not be honoured (USB unplugged,
 * Windows locale rename, driver change, etc.). The recording continues with
 * the system default — the toast tells the user *which* device is actually
 * capturing audio so silent transcription failures stop being a mystery.
 *
 * Mount once at the app root.
 */
export function useMicrophoneFallbackToast(): void {
  useEffect(() => {
    const subs = createSubscriptionGroup()

    const subscribe = async () => {
      subs.on<MicrophoneFallbackPayload>(
        TauriEvent.MICROPHONE_FALLBACK,
        (event) => {
          const requested = event.payload?.requested ?? 'micrófono preferido'
          const actual = event.payload?.actual ?? 'desconocido'
          toast.warning(`Usando "${actual}" en su lugar`, {
            description: `Tu micrófono preferido (${requested}) ${describeReason(event.payload?.reason)}.`,
            duration: 8000,
          })
        },
      )

      // Preflight de grabación: el "micrófono" resuelto es un loopback del audio
      // del sistema (Stereo Mix y afines) — la voz del usuario no se grabará.
      subs.on<MicLoopbackPayload>(
        TauriEvent.MIC_LOOPBACK_WARNING,
        (event) => {
          const device = event.payload?.device ?? 'dispositivo desconocido'
          toast.warning('El micrófono seleccionado no es un micrófono', {
            description: `"${device}" es un loopback del audio del sistema: tu voz no se grabará. Elige otro micrófono en Configuración o en el widget.`,
            duration: 15000,
          })
        },
      )

      // Watchdog de silencio (Rust, recording_helpers): el mic lleva N s sin
      // audio durante grabación activa — o el stream se atascó ("stalled") o
      // entrega ceros exactos ("silent", típico mute por hardware o cambio de
      // perfil Bluetooth A2DP↔HFP). Una alerta por episodio (latch en Rust).
      subs.on<MicSilencePayload>(
        TauriEvent.MIC_SILENCE_WARNING,
        (event) => {
          const device = event.payload?.device ?? 'el micrófono'
          const secs = event.payload?.silenceSecs ?? 0
          const description =
            event.payload?.mode === 'stalled'
              ? `"${device}" dejó de entregar audio hace ${secs} s. Desconéctalo y vuelve a conectarlo, o elige otro micrófono en el widget.`
              : `"${device}" lleva ${secs} s en silencio absoluto. Revisa que no esté silenciado (botón de mute) o que tus audífonos Bluetooth no hayan cambiado de perfil.`
          toast.warning('No se detecta audio del micrófono', {
            description,
            duration: 12000,
          })
        },
      )
      // Guardia de perfil Bluetooth (Rust, bluetooth_guard): se evitó grabar
      // del micrófono de unos audífonos BT para no conmutarlos de A2DP a manos
      // libres. NO se reusa `microphone-fallback` porque su copy dice "no está
      // conectado", y aquí el headset sí lo está: el mensaje sería falso.
      subs.on<BluetoothMicAvoidedPayload>(
        TauriEvent.BLUETOOTH_MIC_AVOIDED,
        (event) => {
          const output = event.payload?.outputDevice ?? 'tus audífonos Bluetooth'
          if (event.payload?.applied) {
            const substitute = event.payload?.substituteMic ?? 'otro micrófono'
            toast.info(`Grabando con "${substitute}" para no cortar tu audio`, {
              description: `${output} no puede reproducir en estéreo y grabar al mismo tiempo. Maity usa otro micrófono para que tu música y tus llamadas sigan sonando bien. Puedes cambiarlo en el selector de dispositivos.`,
              duration: 10000,
            })
          } else {
            const mic = event.payload?.bluetoothMic ?? 'el micrófono Bluetooth'
            toast.warning('Sin micrófono alterno disponible', {
              description: `Se grabará con "${mic}", así que ${output} pasará a modo manos libres y el audio sonará en mono mientras dure la grabación. Conecta un micrófono USB o usa el del equipo para evitarlo.`,
              duration: 12000,
            })
          }
        },
      )
      // Falla clasificada al abrir un dispositivo de captura (Rust,
      // audio::device_errors). Un SOLO listener cubre los cuatro caminos de
      // arranque: antes el toast de "micrófono no disponible" vivía únicamente
      // dentro del listener del meeting-detector, y los otros tres se conformaban
      // con un setStatus(ERROR) genérico.
      //
      // Se ramifica por `code`, NUNCA por el texto de `raw`: Windows traduce sus
      // mensajes de error, así que un match por substring en inglés no dispara
      // en una máquina en español — que es justo donde ocurrió el incidente.
      subs.on<AudioDeviceErrorPayload>(
        TauriEvent.AUDIO_DEVICE_ERROR,
        (event) => {
          const payload = event.payload
          if (!payload) return

          const canOpenPrivacy =
            payload.remediation === 'open_microphone_privacy_settings'

          toast.error(payload.userMessage, {
            description: canOpenPrivacy
              ? 'Actívalo en Configuración → Privacidad → Micrófono y vuelve a intentar.'
              : payload.raw,
            duration: 15000,
            action: canOpenPrivacy
              ? {
                  label: 'Abrir configuración',
                  onClick: () => {
                    invoke('open_microphone_privacy_settings').catch((err) => {
                      logger.warn('[audio] no se pudo abrir la privacidad del micrófono:', err)
                    })
                  },
                }
              : undefined,
          })
        },
      )
    }

    subscribe()

    return () => subs.dispose()
  }, [])
}
