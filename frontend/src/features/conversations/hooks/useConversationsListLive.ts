'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const REALTIME_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Subscribe to maity.omi_conversations changes for the current user and
 * invalidate the list query so the UI re-renders with the authoritative
 * cloud state. Mirrors the resilient pattern of `useConversationLive`
 * (detail view) applied at the list level:
 *
 *   - Realtime subscription with auto-reconnect (2s → 30s + ±20% jitter)
 *   - 5s timeout to detect "never SUBSCRIBED" silent failures
 *   - Visibility + online listeners that invalidate on resume
 *   - Listens to CloudSyncWorker's `finalize-completed` event as a final
 *     belt-and-suspenders trigger for cache invalidation
 *
 * The list query (`['omi-conversations', userId]`) does the actual refetch;
 * this hook only emits invalidations.
 */
export function useConversationsListLive(userId: string | null | undefined): void {
  const queryClient = useQueryClient();

  // Realtime subscription with auto-reconnect.
  useEffect(() => {
    if (!userId) return;

    const queryKey = ['omi-conversations', userId];

    let cleanedUp = false;
    let attempt = 0;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;

    const computeBackoffMs = (n: number) => {
      const base = Math.min(2_000 * 2 ** n, 30_000);
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      return Math.max(500, Math.floor(base + jitter));
    };

    const scheduleReconnect = () => {
      if (cleanedUp || reconnectTimer) return;
      const delay = computeBackoffMs(attempt);
      attempt += 1;
      logger.warn(`[useConversationsListLive] Realtime reconnect scheduled in ${delay}ms (attempt ${attempt}) for user ${userId}`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (cleanedUp) return;

      if (currentChannel) {
        try { void currentChannel.unsubscribe(); } catch { /* ignore */ }
        currentChannel = null;
      }
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }

      // Per-attempt staleness flag — ignore late callbacks from a channel we
      // already abandoned (CLOSED arriving after the connect timer fired, etc.).
      let stale = false;

      const channel = supabase
        .channel(`omi-conv-list-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'maity',
            table: 'omi_conversations',
            filter: `user_id=eq.${userId}`,
          },
          () => {
            queryClient.invalidateQueries({ queryKey });
          },
        )
        .subscribe((status, err) => {
          if (cleanedUp || stale) return;
          if (status === 'SUBSCRIBED') {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            attempt = 0;
            logger.debug(`[useConversationsListLive] Realtime SUBSCRIBED for user ${userId}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            stale = true;
            if (err) logger.warn(`[useConversationsListLive] Realtime ${status} for user ${userId}: ${err.message}`);
            else logger.warn(`[useConversationsListLive] Realtime ${status} for user ${userId}`);
            scheduleReconnect();
          }
        });

      currentChannel = channel;

      connectTimer = setTimeout(() => {
        if (cleanedUp || stale) return;
        stale = true;
        logger.warn(`[useConversationsListLive] Realtime did not reach SUBSCRIBED in ${REALTIME_CONNECT_TIMEOUT_MS}ms for user ${userId}`);
        scheduleReconnect();
      }, REALTIME_CONNECT_TIMEOUT_MS);
    };

    subscribe();

    return () => {
      cleanedUp = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentChannel) {
        try { void currentChannel.unsubscribe(); } catch { /* ignore */ }
        currentChannel = null;
      }
    };
  }, [userId, queryClient]);

  // Visibility + online listeners — force invalidate on resume so the list
  // catches up without waiting for the polling floor or Realtime hint.
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

  // CloudSyncWorker emits `finalize-completed` when a finalize_conversation
  // job lands successfully. Belt-and-suspenders trigger in case Realtime is
  // silently degraded — invalidate the list so the new row appears.
  useEffect(() => {
    if (!userId) return;
    const queryKey = ['omi-conversations', userId];
    const onFinalize = () => {
      queryClient.invalidateQueries({ queryKey });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('finalize-completed', onFinalize);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('finalize-completed', onFinalize);
      }
    };
  }, [userId, queryClient]);
}
