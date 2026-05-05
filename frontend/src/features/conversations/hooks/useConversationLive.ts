'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getOmiConversation } from '../services/conversations.service';
import type { OmiConversation } from '../services/conversations.service';
import { derivePhase, isTerminalPhase, type AnalysisPhase } from '../utils/derivePhase';

const POLL_INTERVAL_MS = 3_000;
const REALTIME_CONNECT_TIMEOUT_MS = 5_000;

export type RealtimeStatus = 'connecting' | 'live' | 'degraded';

export interface UseConversationLiveResult {
  conversation: OmiConversation;
  phase: AnalysisPhase;
  realtimeStatus: RealtimeStatus;
  refetch: () => Promise<void>;
}

const conversationQueryKey = (id: string) => ['omi-conversation', id] as const;

/**
 * Live conversation hook — single source of truth for the detail view.
 *
 * Architectural pattern: cache-then-network + reconcile-on-mount + Realtime hint + polling floor.
 * The DB row is the only source of truth; Realtime events only invalidate the query cache.
 *
 * Layers (in priority order):
 *   1. Reconcile-on-mount: TanStack Query unconditionally fetches the row when this hook mounts.
 *   2. Realtime hint: postgres_changes filtered by `id`. On any UPDATE, invalidate + refetch.
 *      The subscribe callback tracks status; if it doesn't reach SUBSCRIBED in 5s, the UI
 *      shows `realtimeStatus: 'degraded'` and polling becomes the primary path.
 *   3. Polling floor: refetchInterval=3s while phase is non-terminal AND age <= 6 min.
 *      Stops automatically when phase reaches a terminal state.
 *   4. Visibility/online refetch: when the OS suspends and resumes, or network comes back,
 *      refetch immediately (Page Visibility API).
 *
 * Cloud-only. Local-only conversations (no Supabase row yet) bypass this hook entirely.
 */
export function useConversationLive(
  conversationId: string,
  initialData: OmiConversation | undefined,
  enabled: boolean,
): UseConversationLiveResult {
  const queryClient = useQueryClient();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');

  const query = useQuery({
    queryKey: conversationQueryKey(conversationId),
    queryFn: async () => {
      const fresh = await getOmiConversation(conversationId);
      if (!fresh) throw new Error(`Conversation not found: ${conversationId}`);
      return fresh;
    },
    initialData,
    enabled,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (q) => {
      const data = q.state.data as OmiConversation | undefined;
      if (!data) return POLL_INTERVAL_MS;
      const phase = derivePhase(data);
      return isTerminalPhase(phase) || phase === 'stalled' ? false : POLL_INTERVAL_MS;
    },
    retry: 2,
  });

  const conversation = (query.data ?? initialData) as OmiConversation;

  // Realtime subscription — only cloud rows.
  useEffect(() => {
    if (!enabled) return;

    let degradedTimer: ReturnType<typeof setTimeout> | null = null;
    // Distinguishes a real server-side CLOSED (RLS reject, network) from the
    // CLOSED that the subscribe callback receives synchronously when our
    // cleanup calls channel.unsubscribe() — those are expected and must not
    // surface as 'degraded' or warn-log noise.
    let cleanedUp = false;
    setRealtimeStatus('connecting');

    const channel = supabase
      .channel(`omi-conv-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'maity',
          table: 'omi_conversations',
          filter: `id=eq.${conversationId}`,
        },
        () => {
          // Hint only — invalidate so TanStack refetches authoritative state.
          queryClient.invalidateQueries({ queryKey: conversationQueryKey(conversationId) });
        },
      )
      .subscribe((status, err) => {
        if (cleanedUp) return;
        if (status === 'SUBSCRIBED') {
          if (degradedTimer) {
            clearTimeout(degradedTimer);
            degradedTimer = null;
          }
          setRealtimeStatus('live');
          logger.debug(`[useConversationLive] Realtime SUBSCRIBED for ${conversationId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('degraded');
          if (err) logger.warn(`[useConversationLive] Realtime ${status} for ${conversationId}: ${err.message}`);
          else logger.warn(`[useConversationLive] Realtime ${status} for ${conversationId}`);
        }
      });

    // If we don't reach SUBSCRIBED within 5s, surface degraded state. Polling floor still rescues.
    degradedTimer = setTimeout(() => {
      setRealtimeStatus((prev) => (prev === 'connecting' ? 'degraded' : prev));
      logger.warn(`[useConversationLive] Realtime did not reach SUBSCRIBED in ${REALTIME_CONNECT_TIMEOUT_MS}ms for ${conversationId}`);
    }, REALTIME_CONNECT_TIMEOUT_MS);

    return () => {
      cleanedUp = true;
      if (degradedTimer) clearTimeout(degradedTimer);
      void channel.unsubscribe();
    };
  }, [conversationId, enabled, queryClient]);

  // Visibility + online listeners — force refetch on resume.
  // Single shared ref to avoid stale-closure refetch.
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refetchRef.current();
      }
    };
    const onOnline = () => {
      void refetchRef.current();
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
  }, [enabled]);

  const phase: AnalysisPhase = useMemo(() => {
    if (!conversation) return 'idle';
    return derivePhase(conversation);
  }, [conversation]);

  return {
    conversation,
    phase,
    realtimeStatus,
    refetch: async () => {
      await query.refetch();
    },
  };
}
