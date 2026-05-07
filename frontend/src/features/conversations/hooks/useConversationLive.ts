'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { getOmiConversation, reanalyzeConversation } from '../services/conversations.service';
import type { OmiConversation } from '../services/conversations.service';
import { derivePhase, isTerminalPhase, type AnalysisPhase } from '../utils/derivePhase';

const FAILED_AUTO_RETRY_DELAY_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;
const STALLED_POLL_INTERVAL_MS = 15_000;

export interface UseConversationLiveResult {
  conversation: OmiConversation;
  phase: AnalysisPhase;
  refetch: () => Promise<OmiConversation | undefined>;
}

const conversationQueryKey = (id: string) => ['omi-conversation', id] as const;

/**
 * Live conversation hook — single source of truth for the detail view.
 *
 * Architectural pattern: cache-then-network + reconcile-on-mount + polling floor.
 * The DB row is the only source of truth. Realtime is owned globally by
 * GlobalConversationNotifier (mounted at root layout) which invalidates the
 * `['omi-conversation', id]` query on any UPDATE for the current user.
 *
 * Layers (in priority order):
 *   1. Reconcile-on-mount: TanStack Query unconditionally fetches the row when this hook mounts.
 *   2. Polling floor: refetchInterval=3s while phase is non-terminal AND age <= 6 min.
 *      Stops automatically when phase reaches a terminal state.
 *   3. Visibility/online refetch: when the OS suspends and resumes, or network comes back,
 *      refetch immediately (Page Visibility API).
 *   4. Self-healing on access: stalled rows trigger one auto-retry per mount.
 *   5. Transparent failure retry: failed rows retry once after 60s before surfacing.
 *
 * Cloud-only. Local-only conversations (no Supabase row yet) bypass this hook entirely.
 */
export function useConversationLive(
  conversationId: string,
  initialData: OmiConversation | undefined,
  enabled: boolean,
): UseConversationLiveResult {
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

  // Self-healing on access: when the row is detected as stalled (backend heartbeat
  // stopped), dispatch one transparent retry per mount. The backend dedupes via
  // analysis_dispatch_locks, so concurrent triggers from cloudSyncWorker are safe.
  const stuckRescueFiredRef = useRef(false);
  useEffect(() => {
    if (!enabled || stuckRescueFiredRef.current) return;
    if (phase !== 'stalled') return;
    stuckRescueFiredRef.current = true;
    logger.info(`[useConversationLive] Stalled detected for ${conversationId}, dispatching auto-retry`);
    reanalyzeConversation(conversationId, '', 'es').catch((err) => {
      logger.warn(`[useConversationLive] Stalled auto-retry failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [enabled, phase, conversationId]);

  // Transparent failure retry: after one terminal failure, wait 60s and retry once
  // before surfacing the error to the user. Covers transient provider blips that
  // would otherwise force a manual click on "Reintentar".
  const failedRetryFiredRef = useRef(false);
  useEffect(() => {
    if (!enabled || failedRetryFiredRef.current) return;
    if (phase !== 'failed') return;
    const timer = setTimeout(() => {
      failedRetryFiredRef.current = true;
      logger.info(`[useConversationLive] Auto-retry after failed for ${conversationId}`);
      reanalyzeConversation(conversationId, '', 'es').catch((err) => {
        logger.warn(`[useConversationLive] Failed auto-retry failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, FAILED_AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, phase, conversationId]);

  // Realtime updates arrive via GlobalConversationNotifier (root layout):
  // it invalidates ['omi-conversation', id] on UPDATE; TanStack Query's
  // default refetchType: 'active' ensures this hook refetches when mounted.

  return {
    conversation,
    phase,
    refetch: async () => {
      const result = await query.refetch();
      return result.data;
    },
  };
}
