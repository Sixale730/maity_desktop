'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { OmiConversation } from '@/features/conversations/services/conversations.service';

const REALTIME_CONNECT_TIMEOUT_MS = 5_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'skipped']);

/**
 * Single-session Realtime subscription to maity.omi_conversations for the
 * authenticated user. Mounted at the root layout so it persists across navigation.
 *
 * Responsibilities:
 *   1. Invalidate TanStack Query caches on any UPDATE (list + detail).
 *   2. Surface a toast notification when an analysis transitions to 'completed'.
 *   3. Auto-reconnect with backoff + re-setAuth on each subscribe.
 *
 * This replaces the per-component Realtime subscriptions that previously lived
 * in useConversationLive and useConversationsListLive. Pattern: lifecycle of
 * the subscription = lifecycle of the session, NOT of any component.
 */
export function GlobalConversationNotifier() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Realtime payload.old can arrive empty under RLS, so we keep our own shadow
  // map of the previous status per conversation id to detect real transitions
  // (the backend writes updated_at every 30s during processing — without this
  // we'd spam a toast on every heartbeat).
  const prevStatusRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      prevStatusRef.current.clear();
      return;
    }

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
      logger.warn(`[GlobalConversationNotifier] Reconnect in ${delay}ms (attempt ${attempt})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void subscribe();
      }, delay);
    };

    const handleUpdate = (newRow: Partial<OmiConversation>) => {
      if (!newRow.id) return;

      // Invalidate so any active hook (list or detail) refetches.
      queryClient.invalidateQueries({ queryKey: ['omi-conversations', userId] });
      queryClient.invalidateQueries({ queryKey: ['omi-conversation', newRow.id] });

      // Detect transition to terminal — only fire toast on real transition,
      // not on every heartbeat (updated_at changes every 30s during processing).
      const newStatus = newRow.analysis_status ?? null;
      const prevStatus = prevStatusRef.current.get(newRow.id) ?? null;
      prevStatusRef.current.set(newRow.id, newStatus);

      const wasNonTerminal = !prevStatus || !TERMINAL_STATUSES.has(prevStatus);

      if (wasNonTerminal && newStatus === 'completed') {
        const conversationId = newRow.id;
        toast.success('Análisis listo', {
          description: newRow.title || 'Tu conversación ya tiene resumen y análisis completos.',
          duration: 6000,
          action: {
            label: 'Ver',
            onClick: () => router.push(`/conversations?id=${conversationId}`),
          },
        });
      }
      // Note: 'failed' and 'skipped' do NOT show toast. The user sees the
      // 'Reintentar' button in the detail view if they navigate there.
    };

    const subscribe = async () => {
      if (cleanedUp) return;

      if (currentChannel) {
        try { void currentChannel.unsubscribe(); } catch { /* ignore */ }
        currentChannel = null;
      }
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }

      // Refresh Realtime auth before opening — guards against stale JWT after
      // a token refresh raced with this subscribe.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      } catch (e) {
        logger.warn(`[GlobalConversationNotifier] setAuth failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (cleanedUp) return;

      let stale = false;

      const channel = supabase
        .channel(`global-conv-notifier-${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'maity',
            table: 'omi_conversations',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            handleUpdate(payload.new as Partial<OmiConversation>);
          },
        )
        .subscribe((status, err) => {
          if (cleanedUp || stale) return;
          if (status === 'SUBSCRIBED') {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            attempt = 0;
            logger.debug(`[GlobalConversationNotifier] SUBSCRIBED for user ${userId}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            stale = true;
            if (err) logger.warn(`[GlobalConversationNotifier] ${status}: ${err.message}`);
            else logger.warn(`[GlobalConversationNotifier] ${status}`);
            scheduleReconnect();
          }
        });

      currentChannel = channel;

      connectTimer = setTimeout(() => {
        if (cleanedUp || stale) return;
        stale = true;
        logger.warn(`[GlobalConversationNotifier] Did not reach SUBSCRIBED in ${REALTIME_CONNECT_TIMEOUT_MS}ms`);
        scheduleReconnect();
      }, REALTIME_CONNECT_TIMEOUT_MS);
    };

    void subscribe();

    return () => {
      cleanedUp = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentChannel) {
        try { void currentChannel.unsubscribe(); } catch { /* ignore */ }
        currentChannel = null;
      }
      prevStatusRef.current.clear();
    };
  }, [user?.id, queryClient, router]);

  return null;
}
