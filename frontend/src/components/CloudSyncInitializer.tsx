'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { cloudSyncWorker } from '@/services/cloudSyncWorker';
import { logger } from '@/lib/logger';

/**
 * Starts/stops the cloud sync worker based on auth state.
 * Also nudges the worker when the browser comes back online.
 */
export function CloudSyncInitializer() {
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();

  const userId = user?.id ?? null;

  useEffect(() => {
    if (isAuthenticated && userId) {
      cloudSyncWorker.start(userId);
    } else {
      cloudSyncWorker.stop();
    }

    return () => {
      cloudSyncWorker.stop();
    };
  }, [isAuthenticated, userId]);

  // Nudge worker when network comes back
  useEffect(() => {
    const handleOnline = () => {
      logger.debug('[CloudSyncInitializer] Network online, nudging sync worker');
      cloudSyncWorker.nudge();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Notify user (non-blocking toast) when the cloud-side analysis pipeline
  // completes for a conversation they recorded. The cloudSyncWorker emits
  // 'finalize-completed' once the finalize_conversation job succeeds.
  useEffect(() => {
    const handleFinalize = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail;
      const id = detail?.conversationId;
      if (!id) return;
      toast.success('Análisis listo', {
        description: 'Tu conversación ya tiene resumen y análisis completos.',
        duration: 6000,
        action: {
          label: 'Ver',
          onClick: () => router.push(`/conversations?id=${id}`),
        },
      });
    };
    window.addEventListener('finalize-completed', handleFinalize as EventListener);
    return () => window.removeEventListener('finalize-completed', handleFinalize as EventListener);
  }, [router]);

  return null;
}
