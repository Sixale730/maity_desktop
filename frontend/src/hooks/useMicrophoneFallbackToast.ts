import { useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

interface MicrophoneFallbackPayload {
  requested?: string
  actual?: string
  reason?: 'not_found' | 'invalid_format' | string
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
    let unlisten: UnlistenFn | undefined

    const subscribe = async () => {
      unlisten = await listen<MicrophoneFallbackPayload>(
        'microphone-fallback',
        (event) => {
          const requested = event.payload?.requested ?? 'micrófono preferido'
          const actual = event.payload?.actual ?? 'desconocido'
          toast.warning(`Usando "${actual}" en su lugar`, {
            description: `Tu micrófono preferido (${requested}) ${describeReason(event.payload?.reason)}.`,
            duration: 8000,
          })
        },
      )
    }

    subscribe()

    return () => {
      unlisten?.()
    }
  }, [])
}
