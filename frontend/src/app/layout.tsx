'use client'

import './globals.css'
import { Source_Sans_3 } from 'next/font/google'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import { Toaster, toast } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { CoachProvider } from '@/contexts/CoachContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MeetingDetectionDialog } from '@/components/MeetingDetectionDialog'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { AutoSetupOverlay } from '@/components/AutoSetupOverlay'
import { logger } from '@/lib/logger'

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-sans-3',
})

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)

  // Prevent hydration mismatch: render nothing until client mounts.
  // Tauri desktop apps don't benefit from SSR, so this is safe.
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    // Check onboarding status first
    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        const isComplete = status?.completed ?? false
        setOnboardingCompleted(isComplete)

        if (!isComplete) {
          logger.debug('[Layout] Onboarding not completed, showing onboarding flow')
          setShowOnboarding(true)
        } else {
          logger.debug('[Layout] Onboarding completed, showing main app')
        }
      })
      .catch((error) => {
        logger.error('[Layout] Failed to check onboarding status:', error)
        // Default to showing onboarding if we can't check
        setShowOnboarding(true)
        setOnboardingCompleted(false)
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
  useEffect(() => {
    // Listen for tray recording toggle request
    const unlisten = listen('request-recording-toggle', () => {
      logger.debug('[Layout] Received request-recording-toggle from tray');

      if (showOnboarding) {
        toast.error("Por favor completa la configuración primero", {
          description: "Necesitas terminar la configuración inicial antes de poder grabar."
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        logger.debug('[Layout] Forwarding to start-recording-from-sidebar');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [showOnboarding]);

  const handleOnboardingComplete = () => {
    logger.debug('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    setOnboardingCompleted(true)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  return (
    <html lang="es" className="dark">
      <body className={`${sourceSans3.variable} font-sans antialiased bg-white dark:bg-gray-950`}>
        {!mounted ? (
          <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
            <div className="text-gray-500 text-sm">Cargando Maity...</div>
          </div>
        ) : (
        <>
        <a href="#main-content"
           className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-black">
          Skip to main content
        </a>
        <ErrorBoundary>
        <AnalyticsProvider>
          <RecordingStateProvider>
            <TranscriptProvider>
              <CoachProvider>
              <ConfigProvider>
                <OllamaDownloadProvider>
                  <OnboardingProvider>
                    <UpdateCheckProvider>
                      <SidebarProvider>
                        <TooltipProvider>
                          <RecordingPostProcessingProvider>
                            {/* Download progress toast provider - listens for background downloads */}
                            <DownloadProgressToastProvider />

                            {/* Meeting detection dialog - listens for meeting-detected events */}
                            <MeetingDetectionDialog />

                            {/* Show onboarding or main app */}
                            {showOnboarding ? (
                              <OnboardingFlow onComplete={handleOnboardingComplete} />
                            ) : (
                              <div className="flex flex-col h-screen">
                                {/* Offline indicator at the top */}
                                <OfflineIndicator />
                                <div className="flex flex-1 overflow-hidden">
                                  <Sidebar />
                                  <MainContent>{children}</MainContent>
                                </div>
                              </div>
                            )}
                          </RecordingPostProcessingProvider>
                        </TooltipProvider>
                      </SidebarProvider>
                    </UpdateCheckProvider>
                  </OnboardingProvider>

                </OllamaDownloadProvider>
              </ConfigProvider>
              </CoachProvider>
            </TranscriptProvider>
          </RecordingStateProvider>
        </AnalyticsProvider>
        </ErrorBoundary>
        <Toaster position="bottom-center" richColors closeButton />
        <AutoSetupOverlay />
        </>
        )}
      </body>
    </html>
  )
}
