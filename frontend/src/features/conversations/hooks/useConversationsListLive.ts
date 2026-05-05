'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Subscribe to maity.omi_conversations changes for the current user and
 * invalidate the list query so the UI re-renders with the authoritative
 * cloud state. Mirrors the pattern of `useConversationLive` (detail view)
 * applied at the list level.
 *
 * The `useConversationsListLive` hook has no return value — it only emits
 * cache invalidations; the list query (`['omi-conversations', userId]`)
 * does the actual refetch.
 *
 * Realtime auth is propagated via supabase.realtime.setAuth() in AuthContext
 * (Bug 2 fix); this hook can subscribe immediately after maityUser is ready.
 *
 * Ref: https://supabase.com/docs/guides/realtime/postgres-changes
 */
export function useConversationsListLive(userId: string | null | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const queryKey = ['omi-conversations', userId];

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
        if (status === 'SUBSCRIBED') {
          logger.debug(`[useConversationsListLive] SUBSCRIBED for user ${userId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (err) logger.warn(`[useConversationsListLive] ${status}: ${err.message}`);
          else logger.warn(`[useConversationsListLive] ${status}`);
        }
        // Note: CLOSED is normal on cleanup (unsubscribe). We do NOT log it
        // as warn because it would create noise on every navigation.
      });

    return () => {
      void channel.unsubscribe();
    };
  }, [userId, queryClient]);
}
