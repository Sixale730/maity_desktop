'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  analysisPollingService,
  ANALYSIS_COMPLETED,
} from '@/services/analysisPollingService';

/**
 * Starts/stops the AnalysisPollingService based on auth state.
 * Shows a toast when analysis completes while user is on another page.
 *
 * Mounted in layout.tsx inside <AuthGate>, same pattern as CloudSyncInitializer.
 */
export function AnalysisPollingInitializer() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      analysisPollingService.start();
    } else {
      analysisPollingService.stop();
    }

    return () => {
      analysisPollingService.stop();
    };
  }, [isAuthenticated]);

  // Show toast when analysis completes (user may be on a different page)
  useEffect(() => {
    const handleCompleted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const title = detail?.title || 'Conversacion';
      toast.success('Analisis completado', {
        description: title,
        duration: 5000,
      });
    };

    window.addEventListener(ANALYSIS_COMPLETED, handleCompleted);
    return () => window.removeEventListener(ANALYSIS_COMPLETED, handleCompleted);
  }, []);

  return null;
}
