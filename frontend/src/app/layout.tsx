'use client'

import './globals.css'
import { usePathname, useRouter } from 'next/navigation'
import { Source_Sans_3, Inter } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import { Toaster } from 'sonner'
import { useState, useEffect, useRef } from 'react'
import { emit } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/Onboarding'
import { UpdateCheckProvider } from '@/components/updates/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { ChunkErrorRecovery } from '@/components/shared/ChunkErrorRecovery'
import { MeetingDetectionDialog } from '@/components/meeting-detection/MeetingDetectionDialog'
import { RivalInstallDialog } from '@/components/rival-install/RivalInstallDialog'
import { ScheduledRecordingIndicator } from '@/components/scheduled-recording/ScheduledRecordingIndicator'
import { ScheduledRecordingSetupGate } from '@/components/scheduled-recording/ScheduledRecordingSetupGate'
import { scheduledRecordingService } from '@/services/scheduledRecordingService'
import { OfflineIndicator } from '@/components/shared/OfflineIndicator'
import { RecordingWidgetFAB } from '@/components/shared/RecordingWidgetFAB'
import { RecordingWidgetListener } from '@/components/RecordingWidgetListener'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ParakeetAutoDownloadProvider } from '@/contexts/ParakeetAutoDownloadContext'
import { useRegistrationGate } from '@/hooks/useRegistrationGate'
import { OnboardingDownloadWidget } from '@/components/Onboarding/OnboardingDownloadWidget'
import { OnboardingAccountBadge } from '@/components/Onboarding/OnboardingAccountBadge'
import { ModelDownloadGate } from '@/components/ModelDownloadGate'
import { BackgroundDownloadStarter } from '@/components/Onboarding/BackgroundDownloadStarter'
import { LoginScreen } from '@/components/Auth'
import { CloudSyncInitializer } from '@/components/CloudSyncInitializer'
import { ErrorTelemetryInitializer } from '@/components/ErrorTelemetryInitializer'
import { GlobalConversationNotifier } from '@/components/GlobalConversationNotifier'
import { HealthHeartbeatInitializer } from '@/components/HealthHeartbeatInitializer'
import { DbInitErrorGate } from '@/components/DbInitErrorGate'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import Script from 'next/script'
import { logger } from '@/lib/logger'
import { fileLogger } from '@/lib/fileLogger'
import { platformLogger } from '@/lib/platformLogger'
import { TauriEvent } from '@/lib/tauri-events'
import { isAuxWindowPath } from '@/lib/auxWindows'
import { usePageViewTracker } from '@/hooks/usePageViewTracker'
import { useMicrophoneFallbackToast } from '@/hooks/useMicrophoneFallbackToast'
import { useCoachMetricsTelemetry } from '@/hooks/useCoachMetricsTelemetry'
import { useAutostartBootstrap } from '@/hooks/useAutostartBootstrap'
import { registerNotificationActionHandler } from '@/lib/nativeNotification'

// Create a client outside the component to avoid re-creating it on every render
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-sans-3',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
})

// export { metadata } from './metadata'

/**
 * SplashScreen: minimal loading screen with logo + spinner.
 *
 * CRITICO — NO dimensionar esto con style="" inline: este es el HTML
 * pre-renderizado (SSG) que pinta PRIMERO en cada hard-reload. Tauri inyecta
 * un nonce a los <style> del HTML buildeado y lo agrega a la CSP; por spec de
 * CSP, la presencia de un nonce en style-src hace que 'unsafe-inline' se
 * IGNORE, asi que WebView2 bloquea todos los atributos style="" del primer
 * paint. Con el <svg> sin tamaño, explotaba al 100% del ancho (flashazo de
 * anillo morado gigante al terminar una grabacion). Por eso los tamaños van
 * como ATRIBUTOS HTML/SVG (inmunes a CSP) y el layout como clases Tailwind
 * (el CSS externo viene de 'self' y es render-blocking → aplica al primer
 * paint). Colores/opacidades del spinner: atributos SVG, tambien inmunes.
 */
function SplashScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-black">
      <img
        src="icon_128x128.png"
        alt="Maity"
        width={56}
        height={56}
        className="opacity-90"
      />
      <svg
        width={24}
        height={24}
        className="animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle opacity="0.25" cx="12" cy="12" r="10" stroke="#a78bfa" strokeWidth="4" />
        <path opacity="0.75" fill="#a78bfa" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
  )
}

/**
 * AuthGate: renders LoginScreen when not authenticated, otherwise renders children.
 * Must be used inside AuthProvider.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, maityUser, maityUserError, retryFetchMaityUser, signOut } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  // Track AuthGate phase transitions for diagnosis. The dashboard-hang bug
  // can leave us frozen in any of these states; without logs we can't tell
  // which one. Mount timestamp lets us report wall-clock latency to each
  // transition in the exported log.
  const mountedAtRef = useRef<number>(Date.now())
  const lastPhaseRef = useRef<string>('not-mounted')

  useEffect(() => {
    setMounted(true)
  }, [])

  // Phase classification + transition logging
  useEffect(() => {
    let phase: string
    if (!mounted) phase = 'not-mounted'
    else if (isLoading) phase = 'loading'
    else if (!isAuthenticated) phase = 'unauthenticated'
    else if (!maityUser) {
      if (maityUserError) phase = 'error-maityUser'
      else if (timedOut) phase = 'timeout-maityUser'
      else phase = 'waiting-maityUser'
    } else phase = 'ready'

    if (phase !== lastPhaseRef.current) {
      const elapsedMs = Date.now() - mountedAtRef.current
      void fileLogger.info('auth_gate', 'state-transition', {
        prev: lastPhaseRef.current,
        next: phase,
        elapsedMs,
        hasError: !!maityUserError,
      })
      lastPhaseRef.current = phase
    }
  }, [mounted, isLoading, isAuthenticated, maityUser, maityUserError, timedOut])

  // Auto-retry + timeout: if authenticated but maityUser hasn't loaded, retry at 3s and 7s, timeout at 12s
  useEffect(() => {
    if (!isAuthenticated || maityUser || maityUserError) {
      setTimedOut(false)
      return
    }

    const retry1 = setTimeout(() => {
      void fileLogger.info('auth_gate', 'auto-retry', { attempt: 1, afterMs: 3000 })
      retryFetchMaityUser()
    }, 3000)
    const retry2 = setTimeout(() => {
      void fileLogger.info('auth_gate', 'auto-retry', { attempt: 2, afterMs: 7000 })
      retryFetchMaityUser()
    }, 7000)
    const timeout = setTimeout(() => {
      void fileLogger.warn('auth_gate', 'maityUser-timeout', { afterMs: 12000 })
      setTimedOut(true)
    }, 12000)

    return () => {
      clearTimeout(retry1)
      clearTimeout(retry2)
      clearTimeout(timeout)
    }
  }, [isAuthenticated, maityUser, maityUserError, retryFetchMaityUser])

  // Signal Tauri to show the window once we have real content (not splash).
  // This runs once when auth resolves to any visible state.
  const hasSignaledReady = useRef(false)
  useEffect(() => {
    if (!mounted || isLoading || hasSignaledReady.current) return
    // At this point we have real UI to show (login, maityUser wait, or app)
    hasSignaledReady.current = true
    emit(TauriEvent.APP_READY).catch(() => {
      // Silently ignore — may fail outside Tauri (e.g. browser dev)
    })
  }, [mounted, isLoading])

  // SSG hydration placeholder
  if (!mounted) {
    return <SplashScreen />
  }

  // Auth loading state
  if (isLoading) {
    return <SplashScreen />
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return <LoginScreen />
  }

  // Wait for maityUser to be populated (brief gap after fresh OAuth login)
  if (!maityUser) {
    const showError = maityUserError || timedOut

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-6">
        {/* Logo Maity */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ff0050]/10 to-[#485df4]/10 dark:from-[#ff0050]/20 dark:to-[#485df4]/20 flex items-center justify-center shadow-lg">
          <img src="icon_128x128.png" alt="Maity" width={48} height={48} className="w-12 h-12" />
        </div>

        {showError ? (
          <>
            <p className="text-red-400 text-sm text-center max-w-xs">
              {maityUserError || 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setTimedOut(false); retryFetchMaityUser() }}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
              >
                Reintentar
              </button>
              <button
                onClick={() => signOut()}
                className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Spinner */}
            <svg width={24} height={24} className="animate-spin h-6 w-6 text-violet-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-muted-foreground text-sm">Preparando tu cuenta...</p>
          </>
        )}
      </div>
    )
  }

  // Authenticated with maityUser ready — render app content
  return <>{children}</>
}

/**
 * Redirige a /registration si el usuario no ha completado el formulario.
 * Componente separado para poder usar useRouter dentro de un Suspense boundary.
 */
function RegistrationRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/registration')
  }, [router])
  return <SplashScreen />
}

/**
 * AppContent: the main app shell (onboarding check, sidebar, etc.)
 * Rendered only when the user is authenticated.
 */
function AppContent({ children }: { children: React.ReactNode }) {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [, setOnboardingCompleted] = useState(false)
  const [modelGateActive, setModelGateActive] = useState<boolean | null>(null)
  const [showScheduledSetup, setShowScheduledSetup] = useState(false)
  const hasEmittedOpenRef = useRef(false)
  const pathname = usePathname()

  // Gate de registro: solo aplica cuando el onboarding técnico ya completó
  // y el modelo aún no bloqueó (es decir, showOnboarding===false y modelGateActive===false o 0)
  const { registrationFormCompleted, isLoading: registrationLoading } = useRegistrationGate()

  const isRegistrationRoute = pathname === '/registration' || pathname?.startsWith('/billing/plans')
  const isSpecialRoute = isAuxWindowPath(pathname)

  // Inicializa el motor Parakeet y decide si hay que bloquear esperando el modelo.
  // `modelGateActive`: null = comprobando (splash), true = falta el modelo (gate),
  // false = pasar. La descarga en sí la arranca WelcomeStep (cuentas nuevas) o
  // BackgroundDownloadStarter (cuentas existentes) — el gate solo espera.
  const checkModelAvailability = async () => {
    let hasModel = false
    try {
      await invoke('parakeet_init')
      hasModel = await invoke<boolean>('parakeet_has_available_models')
    } catch (error) {
      console.error('[Layout] Failed to init Parakeet engine:', error)
      // Si no podemos afirmar que está, bloqueamos: el gate reintenta y muestra el
      // error real, que es mejor que dejar entrar a un dashboard donde grabar falla.
      hasModel = false
    }
    // El gate se resuelve ANTES de bajar el splash para que no exista ni un frame con
    // el main app visible en cuentas sin modelo (React 18 agrupa ambos setState).
    setModelGateActive(!hasModel)
  }

  // Telemetry: emit nav.page_view to platform_logs on every Next.js route change
  usePageViewTracker()

  // Surface a toast when the user's preferred mic could not be honoured
  // (USB unplugged, Windows locale rename, driver change). The recording
  // continues with the system default; the toast tells the user *which*
  // device is actually capturing audio so silent transcription failures
  // stop being a mystery.
  useMicrophoneFallbackToast()

  // Reenvía el session-summary del coach (métricas LLM + supervisión del
  // sidecar) a Supabase platform_logs. Sin este listener, el evento
  // `coach-metrics` moría en los logs locales sin dejar rastro medible.
  useCoachMetricsTelemetry()

  // Registra Maity en el autostart del OS al primer arranque post-instalación (US-1).
  // El hook hace no-op en builds debug y en arranques subsiguientes. Mostrar el toast
  // requiere que `<Toaster />` ya esté montado (lo está en RootLayout, fuera de AuthGate).
  useAutostartBootstrap()

  // Handler global para la notif accionable "Grabación lista" (US-4): cuando el usuario
  // hace click en "Abrir Maity" desde la notif del OS, restauramos la main window con
  // foco para que el modal de feedback (que está esperando por `feedback_pending_meeting_id`
  // en sessionStorage) sea visible. Idempotente — se registra una vez por mount.
  useEffect(() => {
    void registerNotificationActionHandler('open-main-window', async () => {
      try {
        await invoke('unminimize_and_focus_main')
      } catch (err) {
        logger.warn('[Layout] unminimize_and_focus_main failed:', err)
      }
    })
  }, [])

  // Telemetry: emit app.open once on mount + app.close on tab/window close.
  // Multiple safeguards because beforeunload is unreliable in Tauri native windows
  // (X button on macOS/Windows quit). We listen to:
  //   1. Tauri's onCloseRequested (most reliable for native close)
  //   2. window.beforeunload (works in browser dev + page nav)
  //   3. window.pagehide (more reliable than beforeunload on some platforms)
  // All three call a single deduped emitter so we never log app.close twice.
  // The useRef dedupe on app.open prevents React 18 StrictMode double-mount issues.
  useEffect(() => {
    if (hasEmittedOpenRef.current) return
    hasEmittedOpenRef.current = true

    void platformLogger.log('app.open', {
      referrer: typeof document !== 'undefined' ? document.referrer : null,
      screen: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : null,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
    })

    let hasEmittedClose = false
    const emitClose = () => {
      if (hasEmittedClose) return
      hasEmittedClose = true
      void platformLogger.log('app.close')
    }

    // Browser-level fallbacks (work in dev + on graceful page nav)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', emitClose)
      window.addEventListener('pagehide', emitClose)
    }

    // Tauri native: onCloseRequested fires reliably when user clicks the X button
    // or quits the app natively. Dynamic import so this doesn't crash in pure
    // browser dev mode (where @tauri-apps/api isn't initialized).
    let unlistenTauriClose: (() => void) | undefined
    ;(async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        unlistenTauriClose = await getCurrentWindow().onCloseRequested(() => {
          // Don't preventDefault — let the window close after we log.
          emitClose()
        })
      } catch {
        // Outside Tauri context (e.g. browser dev) — beforeunload covers this case.
      }
    })()

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', emitClose)
        window.removeEventListener('pagehide', emitClose)
      }
      unlistenTauriClose?.()
    }
  }, [])

  useEffect(() => {
    // Check onboarding status first
    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        const isComplete = status?.completed ?? false
        setOnboardingCompleted(isComplete)

        if (!isComplete) {
          logger.debug('[Layout] Onboarding not completed, showing onboarding flow')
          setShowOnboarding(true)
          // Defer model check until onboarding finishes
          setModelGateActive(false)
        } else {
          logger.debug('[Layout] Onboarding completed, checking model availability')
          void checkModelAvailability()
        }
      })
      .catch((error) => {
        console.error('[Layout] Failed to check onboarding status:', error)
        // Default to showing onboarding if we can't check
        setShowOnboarding(true)
        setOnboardingCompleted(false)
        setModelGateActive(false)
      })
  }, [])

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);

  // Una vez resueltos el onboarding y el model gate, decidir si mostrar el gate de
  // activación de la grabación por jornada (solo si el usuario aún no lo atendió).
  useEffect(() => {
    if (modelGateActive !== false || showOnboarding) return
    let cancelled = false
    scheduledRecordingService.getSettings()
      .then((s) => { if (!cancelled && !s.configured_by_user) setShowScheduledSetup(true) })
      .catch(() => { /* si falla, no bloquear la app */ })
    return () => { cancelled = true }
  }, [modelGateActive, showOnboarding])

  const handleOnboardingComplete = () => {
    logger.debug('[Layout] Onboarding completed, entering app')
    setShowOnboarding(false)
    setOnboardingCompleted(true)
    // WelcomeStep ya arrancó ambas descargas en background. Volvemos al splash
    // (null) mientras comprobamos si Parakeet está en disco; si falta, el gate
    // bloqueante lo espera. Gemma sigue en background y nunca bloquea.
    setModelGateActive(null)
    void checkModelAvailability()
  }

  return (
    <RecordingStateProvider>
      <TranscriptProvider>
        <ConfigProvider>
          <ParakeetAutoDownloadProvider>
          <OllamaDownloadProvider>
            <OnboardingProvider>
              <SidebarProvider>
                <TooltipProvider>
                  <RecordingPostProcessingProvider>
                    {/* Progreso de descarga de modelos: ÚNICA superficie = OnboardingDownloadWidget
                        (bolita colapsable). Se eliminó DownloadProgressToastProvider para no
                        duplicar UI (antes salían toasts arriba + widget abajo a la vez). */}

                    {/* Meeting detection dialog - listens for meeting-detected events */}
                    <MeetingDetectionDialog />

                    {/* Aviso de instalación duplicada (Store ⇄ descarga directa): si Maity
                        corre bajo MSIX y detecta la copia NSIS rival, ofrece quitarla.
                        Consulta get_rival_install al montar (pull-based); solo Windows. */}
                    <RivalInstallDialog />

                    {/* Listener global de la grabación programada por jornada:
                        traduce los eventos del scheduler Rust (best-effort) en toasts.
                        Renderiza null; el arranque real vive en Rust. */}
                    <ScheduledRecordingIndicator />

                    {/* Listener global del widget flotante: escucha el evento
                        widget-request-start-recording (emitido por el comando
                        Rust recording_widget_request_start) y dispara
                        handleRecordingStart con todo el contexto canónico.
                        Vive aquí — dentro de TODOS los providers — para estar
                        montado desde el primer paint, sin importar la ruta. */}
                    <RecordingWidgetListener />

                    {/* Arranca las descargas de modelos en background para cuentas existentes
                        a las que les falte el modelo (sin pantalla de consentimiento). Para
                        cuentas nuevas, WelcomeStep ("Bienvenido a Maity") ya las arrancó. */}
                    <BackgroundDownloadStarter />

                    {/* Show onboarding or main app.
                        ORDEN DE RAMAS:
                        1. onboarding técnico — la pantalla de bienvenida (WelcomeStep) es la
                           ÚNICA con arranque de modelos. Su botón "Comenzar y descargar" baja
                           Parakeet + Gemma en background (startBackgroundDownloads) y avanza al
                           instante. NO bloquea. (ModelDownloadGate y ModelDownloadStep eliminados.)
                        2. splash (modelGateActive aún null — comprobando)
                        3. splash (registrationLoading)
                        4. onboarding de registro (/registration) con OnboardingDownloadWidget
                           (progreso de las descargas en la esquina)
                        5. gate bloqueante del modelo de transcripción (ModelDownloadGate):
                           solo Parakeet, y solo si falta en disco. Va después del registro
                           para que los 17 pasos solapen con la descarga, y antes del horario.
                        6. scheduled setup gate
                        7. main app — el OnboardingDownloadWidget sigue mostrando el progreso
                           de Gemma hasta que termina; el usuario ya puede navegar.

                        NO hay pantalla de consentimiento de modelos separada (el consentimiento
                        vive en el botón "Comenzar y descargar" de WelcomeStep). SÍ hay espera
                        bloqueante, pero SOLO para Parakeet: sin ese modelo grabar falla y no hay
                        fallback a otro motor. Gemma nunca bloquea — sigue en background.

                        TODAS las ramas de onboarding (1, 4, 5 y /billing/plans de la 6) montan
                        <OnboardingAccountBadge /> (fixed top-4 right-4 z-[60]): muestra la cuenta
                        activa y permite cerrar sesión, ya que el Sidebar no está montado. */}
                    {showOnboarding ? (
                      <>
                        <OnboardingFlow onComplete={handleOnboardingComplete} />
                        <OnboardingAccountBadge />
                      </>
                    ) : modelGateActive === null ? (
                      <SplashScreen />
                    ) : registrationLoading && !isSpecialRoute && !isRegistrationRoute ? (
                      // Breve splash mientras se carga el estado de registro
                      <SplashScreen />
                    ) : registrationFormCompleted === false && !isSpecialRoute ? (
                      // Onboarding de registro: las descargas corren en background
                      // mientras el usuario completa el formulario de 17 pasos.
                      // OnboardingDownloadWidget muestra el progreso en la esquina.
                      <>
                        {!isRegistrationRoute && (
                          // Redirigir sin tocar Sidebar; el gate se aplica vía efecto
                          <RegistrationRedirect />
                        )}
                        {isRegistrationRoute && <>{children}</>}
                        {/* Widget flotante: acompaña el onboarding de registro */}
                        <OnboardingDownloadWidget />
                        {/* Badge de cuenta activa + cerrar sesión (no hay Sidebar aquí) */}
                        <OnboardingAccountBadge />
                      </>
                    ) : modelGateActive && !isSpecialRoute ? (
                      // GATE BLOQUEANTE DEL MODELO DE TRANSCRIPCIÓN.
                      // Va DESPUÉS del registro (así los 17 pasos solapan con la
                      // descarga) y ANTES del horario. Sin botón de omitir: decisión
                      // explícita — grabar sin este modelo falla y no hay fallback.
                      // NO montar <OnboardingDownloadWidget /> aquí: duplicaría el
                      // progreso de Parakeet que el propio gate ya muestra.
                      <>
                        <ModelDownloadGate onComplete={() => setModelGateActive(false)} />
                        <OnboardingAccountBadge />
                      </>
                    ) : showScheduledSetup ? (
                      <>
                        <ScheduledRecordingSetupGate
                          onDone={() => setShowScheduledSetup(false)}
                        />
                        <OnboardingAccountBadge />
                      </>
                    ) : (
                      <div className="flex flex-col h-screen">
                        {/* Offline indicator at the top */}
                        <OfflineIndicator />
                        <div className="flex flex-1 overflow-hidden">
                          {!isRegistrationRoute && <Sidebar />}
                          <MainContent>{children}</MainContent>
                        </div>
                        {/* Widget de descargas — montado en el main app;
                            se auto-oculta cuando no hay actividad o ambos modelos listos */}
                        <OnboardingDownloadWidget />
                        {/* FAB para reabrir el widget flotante si el usuario lo cerró.
                            Sólo se renderiza cuando la ventana 'recording-widget' está
                            cerrada — el propio componente lo decide y se mantiene en
                            null en otro caso. */}
                        {!isRegistrationRoute && <RecordingWidgetFAB />}
                        {/* En rutas sin Sidebar (/billing/plans) mostrar el badge de cuenta */}
                        {isRegistrationRoute && <OnboardingAccountBadge />}
                      </div>
                    )}
                  </RecordingPostProcessingProvider>
                </TooltipProvider>
              </SidebarProvider>
            </OnboardingProvider>
          </OllamaDownloadProvider>
          </ParakeetAutoDownloadProvider>
        </ConfigProvider>
      </TranscriptProvider>
    </RecordingStateProvider>
  )
}

// Inline script to handle ChunkLoadError before React loads
const chunkErrorRecoveryScript = `
(function() {
  if (typeof window === 'undefined') return;

  var MAX_RETRIES = 3;
  var RETRY_DELAY = 2000;
  var STORAGE_KEY = 'chunkErrorRetryCount';
  var CLEAR_DELAY = 30000;

  // Get current retry count
  var retryCount = parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10);

  // Clear retry count after successful load
  setTimeout(function() {
    sessionStorage.removeItem(STORAGE_KEY);
  }, CLEAR_DELAY);

  function handleChunkError(message) {
    if (retryCount >= MAX_RETRIES) {
      console.error('[ChunkErrorRecovery] Max retries (' + MAX_RETRIES + ') reached. Please restart dev server.');
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    console.warn('[ChunkErrorRecovery] Chunk load error detected: ' + message);
    console.log('[ChunkErrorRecovery] Reloading in ' + RETRY_DELAY + 'ms... (attempt ' + (retryCount + 1) + '/' + MAX_RETRIES + ')');

    sessionStorage.setItem(STORAGE_KEY, String(retryCount + 1));

    setTimeout(function() {
      window.location.reload();
    }, RETRY_DELAY);
  }

  // Catch errors
  window.addEventListener('error', function(e) {
    var msg = e.message || '';
    if (msg.indexOf('ChunkLoadError') !== -1 ||
        msg.indexOf('Loading chunk') !== -1 ||
        msg.indexOf('Failed to fetch') !== -1 ||
        (msg.indexOf('chunk') !== -1 && msg.indexOf('failed') !== -1)) {
      handleChunkError(msg);
    }
  });

  // Catch unhandled promise rejections (dynamic imports)
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason || {};
    var msg = reason.message || String(reason) || '';
    if (msg.indexOf('ChunkLoadError') !== -1 ||
        msg.indexOf('Loading chunk') !== -1 ||
        msg.indexOf('Failed to fetch dynamically imported module') !== -1) {
      handleChunkError(msg);
    }
  });
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Ventanas Tauri secundarias (coach float, recording widget, device picker):
  // Bypass total de auth/sidebar/providers/initializers — son mini-ventanas
  // independientes. Lista canónica en lib/auxWindows.ts.
  // Background transparente en html+body para que el blur de la ventana Tauri
  // (transparent: true) llegue al SO. El body global tiene `bg-background`
  // (negro solido en dark mode) que tapaba el glass effect — override aqui.
  if (isAuxWindowPath(pathname)) {
    return (
      <html lang="es" className="dark" style={{ background: 'transparent' }}>
        <body
          className={`${sourceSans3.variable} ${inter.variable} ${GeistSans.variable} font-sans antialiased`}
          style={{ background: 'transparent' }}
        >
          {children}
        </body>
      </html>
    )
  }

  return (
    <html lang="es" className="dark">
      <body className={`${sourceSans3.variable} ${inter.variable} ${GeistSans.variable} font-sans antialiased`}>
        <Script
          id="chunk-error-recovery"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: chunkErrorRecoveryScript }}
        />
        <ChunkErrorRecovery />
        {/* FUERA de ErrorBoundary/AuthGate: captura errores pre-auth y sigue
            vivo si el boundary desmonta el árbol. Invariante: layout.test.ts */}
        <ErrorTelemetryInitializer />
        <ErrorBoundary>
          {/* DbInitErrorGate vive AFUERA de QueryClientProvider y AuthProvider:
              cuando el SQLite local falla en startup, queremos bloquear todo el
              arbol antes de que cualquier query a Supabase o flujo de auth
              arranque. Si el evento `db-init-failed` no llega, este componente
              renderiza children sin overhead. */}
          <DbInitErrorGate>
          <QueryClientProvider client={queryClient}>
            {/* CRITICAL: <UpdateCheckProvider> debe vivir FUERA de <AuthProvider> y
                <AuthGate>. El plugin updater no requiere sesion Supabase — solo HTTP a
                GitHub. Si lo metes dentro de cualquier gate condicional, el auto-check
                no dispara en maquinas con login lento. Regresion documentada: commit
                230b807 (2026-02-02) → fix 9810541 fallido → fix definitivo este commit.
                Validado por test: src/app/layout.test.ts (PROVIDER_INVARIANTS). */}
            <UpdateCheckProvider>
              <ThemeProvider>
                <AuthProvider>
                  <AuthGate>
                    <CloudSyncInitializer />
                    <HealthHeartbeatInitializer />
                    <GlobalConversationNotifier />
                    <AppContent>{children}</AppContent>
                  </AuthGate>
                </AuthProvider>
              </ThemeProvider>
            </UpdateCheckProvider>
          </QueryClientProvider>
          </DbInitErrorGate>
        </ErrorBoundary>
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
