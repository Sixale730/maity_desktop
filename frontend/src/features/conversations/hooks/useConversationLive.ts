'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getOmiConversation } from '../services/conversations.service';
import type { OmiConversation } from '../services/conversations.service';
import { derivePhase, isTerminalPhase, type AnalysisPhase } from '../utils/derivePhase';

const POLL_INTERVAL_MS = 3_000;
const STALLED_POLL_INTERVAL_MS = 15_000;
const REALTIME_CONNECT_TIMEOUT_MS = 5_000;

export type RealtimeStatus = 'connecting' | 'live' | 'degraded';

export interface UseConversationLiveResult {
  conversation: OmiConversation;
  phase: AnalysisPhase;
  realtimeStatus: RealtimeStatus;
  refetch: () => Promise<OmiConversation | undefined>;
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
      if (isTerminalPhase(phase)) return false;
      if (phase === 'stalled') return STALLED_POLL_INTERVAL_MS;
      return POLL_INTERVAL_MS;
    },
    retry: 2,
  });

  const conversation = (query.data ?? initialData) as OmiConversation;

  // Realtime subscription — only cloud rows.
  // Self-healing: if the channel ever drops (RLS, network, Tauri WebView
  // suspending WS on focus loss, etc.) we reconnect with exponential backoff
  // (2s → 4s → 8s → 16s → 30s cap, ±20% jitter). The polling floor keeps
  // correctness while we're degraded; this just restores the low-latency path.
  useEffect(() => {
    if (!enabled) return;

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
      logger.warn(`[useConversationLive] Realtime reconnect scheduled in ${delay}ms (attempt ${attempt}) for ${conversationId}`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (cleanedUp) return;

      // Tear down prior channel and any pending timers before opening a new one.
      if (currentChannel) {
        try { void currentChannel.unsubscribe(); } catch { /* ignore */ }
        currentChannel = null;
      }
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }

      setRealtimeStatus('connecting');

      // Per-attempt staleness flag: ignore late callbacks from a channel we
      // already abandoned (e.g. CLOSED arriving after the connect timer fired).
      let stale = false;

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
            queryClient.invalidateQueries({ queryKey: conversationQueryKey(conversationId) });
          },
        )
        .subscribe((status, err) => {
          if (cleanedUp || stale) return;
          if (status === 'SUBSCRIBED') {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            attempt = 0;
            setRealtimeStatus('live');
            logger.debug(`[useConversationLive] Realtime SUBSCRIBED for ${conversationId}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            stale = true;
            setRealtimeStatus('degraded');
            if (err) logger.warn(`[useConversationLive] Realtime ${status} for ${conversationId}: ${err.message}`);
            else logger.warn(`[useConversationLive] Realtime ${status} for ${conversationId}`);
            scheduleReconnect();
          }
        });

      currentChannel = channel;

      connectTimer = setTimeout(() => {
        if (cleanedUp || stale) return;
        stale = true;
        setRealtimeStatus((prev) => (prev === 'connecting' ? 'degraded' : prev));
        logger.warn(`[useConversationLive] Realtime did not reach SUBSCRIBED in ${REALTIME_CONNECT_TIMEOUT_MS}ms for ${conversationId}`);
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
      const result = await query.refetch();
      return result.data;
    },
  };
}
