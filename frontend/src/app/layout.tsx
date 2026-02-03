'use client'

import './globals.css'
import { Source_Sans_3 } from 'next/font/google'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider'
import { Toaster, toast } from 'sonner'
import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/Onboarding'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/updates/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { MeetingDetectionDialog } from '@/components/meeting-detection/MeetingDetectionDialog'
import { OfflineIndicator } from '@/components/shared/OfflineIndicator'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { LoginScreen } from '@/components/Auth'

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-sans-3',
})

// export { metadata } from './metadata'

/**
 * AuthGate: renders LoginScreen when not authenticated, otherwise renders children.
 * Must be used inside AuthProvider.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // SSG hydration placeholder
  if (!mounted) {
    return <div className="flex flex-col h-screen bg-[#f5f5f6] dark:bg-gray-900" />
  }

  // Auth loading state
  if (isLoading) {
    return <div className="flex flex-col h-screen bg-[#f5f5f6] dark:bg-gray-900" />
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return <LoginScreen />
  }

  // Authenticated — render app content
  return <>{children}</>
}

/**
 * AppContent: the main app shell (onboarding check, sidebar, etc.)
 * Rendered only when the user is authenticated.
 */
function AppContent({ children }: { children: React.ReactNode }) {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)

  useEffect(() => {
    // Check onboarding status first
    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        const isComplete = status?.completed ?? false
        setOnboardingCompleted(isComplete)

        if (!isComplete) {
          console.log('[Layout] Onboarding not completed, showing onboarding flow')
          setShowOnboarding(true)
        } else {
          console.log('[Layout] Onboarding completed, showing main app')
        }
      })
      .catch((error) => {
        console.error('[Layout] Failed to check onboarding status:', error)
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
      console.log('[Layout] Received request-recording-toggle from tray');

      if (showOnboarding) {
        toast.error("Por favor completa la configuración primero", {
          description: "Necesitas terminar la configuración inicial antes de poder grabar."
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        console.log('[Layout] Forwarding to start-recording-from-sidebar');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [showOnboarding]);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, showing main app')
    setShowOnboarding(false)
    setOnboardingCompleted(true)
  }

  return (
    <RecordingStateProvider>
      <TranscriptProvider>
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
      </TranscriptProvider>
    </RecordingStateProvider>
  )
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${sourceSans3.variable} font-sans antialiased`}>
        <ErrorBoundary>
          <AnalyticsProvider>
            <AuthProvider>
              <AuthGate>
                <AppContent>{children}</AppContent>
              </AuthGate>
            </AuthProvider>
          </AnalyticsProvider>
        </ErrorBoundary>
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
