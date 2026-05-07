'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Force-invalidate the cloud conversations list query when the page becomes
 * visible again or the network reconnects. The Realtime subscription is now
 * owned by GlobalConversationNotifier at the root layout, which invalidates
 * the same query on UPDATE events. This hook is the secondary safety net for
 * when Realtime is silently degraded (Tauri WebView suspending WS on focus
 * loss, network blips, etc.).
 *
 * The list query (`['omi-conversations', userId]`) does the actual refetch;
 * this hook only emits invalidations.
 */
export function useConversationsListAutoRefresh(userId: string | null | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const queryKey = ['omi-conversations', userId];

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey });
      }
    };
    const onOnline = () => {
      queryClient.invalidateQueries({ queryKey });
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
      }
    };
  }, [userId, queryClient]);
}
