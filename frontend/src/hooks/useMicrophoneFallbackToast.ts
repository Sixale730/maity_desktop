/**
 * useMicrophoneFallbackToast
 *
 * Listens for the Rust `microphone-fallback` event and surfaces a toast when
 * the user's preferred mic could not be honoured (unplugged USB, locale
 * change between sessions, driver rename, etc.). The recording continues
 * with the system default — the user just needs to know which device is
 * actually capturing audio.
 *
 * Mount once at app root (layout.tsx).
 */
import { useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

interface MicrophoneFallbackPayload {
  requested?: string
  actual?: string
  reason?: 'not_found' | 'invalid_format'
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

export function useMicrophoneFallbackToast(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined

    const run = async () => {
      unlisten = await listen<MicrophoneFallbackPayload>(
        'microphone-fallback',
        (event) => {
          const requested = event.payload?.requested ?? 'micrófono preferido'
          const actual = event.payload?.actual ?? 'desconocido'
          const reasonText = describeReason(event.payload?.reason)
          toast.warning(`Usando "${actual}" en su lugar`, {
            description: `Tu micrófono preferido (${requested}) ${reasonText}.`,
            duration: 8000,
          })
        }
      )
    }

    run()

    return () => {
      if (unlisten) unlisten()
    }
  }, [])
}
