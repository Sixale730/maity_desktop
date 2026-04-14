'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { cloudSyncWorker } from '@/services/cloudSyncWorker';
import { logger } from '@/lib/logger';

/**
 * Starts/stops the cloud sync worker based on auth state.
 * Also nudges the worker when the browser comes back online.
 */
export function CloudSyncInitializer() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      cloudSyncWorker.start();
    } else {
      cloudSyncWorker.stop();
    }

    return () => {
      cloudSyncWorker.stop();
    };
  }, [isAuthenticated]);

  // Nudge worker when network comes back
  useEffect(() => {
    const handleOnline = () => {
      logger.debug('[CloudSyncInitializer] Network online, nudging sync worker');
      cloudSyncWorker.nudge();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return null;
}
