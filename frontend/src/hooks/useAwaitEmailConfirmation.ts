import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface UseAwaitEmailConfirmationParams {
  /** true solo mientras se muestra la pantalla de espera del signup */
  active: boolean
  email: string
  password: string
}

/**
 * Auto-detección de verificación cross-device (issue #58).
 *
 * Cuando alguien se registra DESDE el desktop, el link de confirmación se abre en
 * otro dispositivo (casi siempre el celular) o en el navegador del sistema — nunca
 * dentro del webview de Tauri. La sesión nace ahí, así que este cliente Supabase
 * jamás se entera de la confirmación. Por eso, mientras la pantalla de espera está
 * visible, sondeamos `signInWithPassword` en silencio: falla con `email_not_confirmed`
 * hasta que hacen clic en el link; al confirmar, el login pasa, la sesión queda en
 * ESTE cliente y el `onAuthStateChange` de AuthContext flipa `isAuthenticated` →
 * `AuthGate` desmonta `LoginScreen` y la app entra sola, sin re-login. Patrón RFC 8628
 * (OAuth Device Authorization Grant): el device que espera sondea hasta que otro
 * completa la auth.
 */
export function useAwaitEmailConfirmation({
  active,
  email,
  password,
}: UseAwaitEmailConfirmationParams) {
  const resolvedRef = useRef(false) // resuelve una sola vez (poll + onAuthStateChange)

  useEffect(() => {
    if (!active || !email || !password) return

    resolvedRef.current = false
    let aborted = false
    let inFlight = false
    let timerId: number | undefined

    const resolve = () => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      aborted = true
      if (timerId !== undefined) window.clearTimeout(timerId)
      // Sin navegación: la sesión ya disparó el onAuthStateChange de AuthContext,
      // que flipa isAuthenticated → AuthGate desmonta LoginScreen y entra la app.
    }

    // Camino rápido (mismo cliente): si aparece una sesión por cualquier vía, parar.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && event === 'SIGNED_IN') resolve()
    })

    // Camino cross-device (el importante): sondeo silencioso con backoff.
    const tick = async () => {
      if (aborted || inFlight) return
      if (document.visibilityState !== 'visible') return // no gastes requests en background
      inFlight = true
      try {
        // signInWithPassword DIRECTO (no el wrapper signInWithEmail del context): el
        // wrapper setea el banner rojo de error y re-lanza en cada fallo, así que
        // `email_not_confirmed` pintaría un error cada pocos segundos. Aquí lo
        // inspeccionamos en silencio.
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (!error && data.session) resolve()
        // `email_not_confirmed` → aún no confirman: seguimos esperando en silencio.
      } catch (err) {
        logger.debug('[useAwaitEmailConfirmation] poll error (ignorado)', err)
      } finally {
        inFlight = false
      }
    }

    // Backoff: arranca en 4s y sube a 12s tras el primer minuto (setInterval no puede
    // cambiar su delay → setTimeout auto-reprogramado). Corta a los 15 min para no
    // golpear el rate limit de GoTrue indefinidamente.
    let delay = 4000
    let elapsed = 0
    const loop = () => {
      timerId = window.setTimeout(async () => {
        await tick()
        elapsed += delay
        if (elapsed >= 60_000) delay = 12_000
        if (!aborted && elapsed < 15 * 60_000) loop()
      }, delay)
    }
    loop()

    return () => {
      aborted = true
      if (timerId !== undefined) window.clearTimeout(timerId)
      sub.subscription.unsubscribe()
    }
  }, [active, email, password])
}
