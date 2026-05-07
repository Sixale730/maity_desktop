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
  // IMPORTANT: maityUser.id is the FK on omi_conversations.user_id and 36 other
  // tables in maity.* schema. Never use user.id (Supabase auth) for queries
  // against maity tables. See feedback_user_vs_maityUser.md.
  const { isAuthenticated, maityUser } = useAuth();

  const userId = maityUser?.id ?? null;

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
