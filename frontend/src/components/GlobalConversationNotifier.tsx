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

/** Fire system notification + in-app toast when a conversation transitions to 'completed'. */
function notifyAnalysisComplete(
  conv: { id: string; title?: string | null },
  router: ReturnType<typeof useRouter>,
) {
  // Instrumentation: confirm this notify path executed (vs being filtered out earlier).
  logger.warn(`[GlobalConversationNotifier] notify FIRED for ${conv.id} title="${conv.title ?? ''}"`);

  const description = conv.title || 'Tu conversación ya tiene resumen y análisis completos.';

  // System-level notification (Windows toast / macOS Notification Center).
  // Wrapper falls back to in-app toast if the plugin isn't available.
  void import('@/lib/nativeNotification')
    .then(({ sendNativeNotification }) =>
      sendNativeNotification({ title: 'Análisis listo', body: description }),
    )
    .catch((e) => console.warn('[GlobalConversationNotifier] native notification failed:', e));

  // In-app toast with action button — kept alongside the native one so the user
  // gets a clickable "Ver" right inside the app even if the OS notification was
  // dismissed quickly.
  toast.success('Análisis listo', {
    description,
    duration: 6000,
    action: {
      label: 'Ver',
      onClick: () => router.push(`/conversations?id=${conv.id}`),
    },
  });
}

/**
 * Single-session Realtime subscription to maity.omi_conversations for the
 * authenticated user. Mounted at the root layout so it persists across navigation.
 *
 * Responsibilities:
 *   1. Invalidate TanStack Query caches on any UPDATE (list + detail).
 *   2. Surface a system + in-app notification when an analysis transitions to 'completed'.
 *   3. Auto-reconnect with backoff + re-setAuth on each subscribe.
 *   4. Defense in depth: also observe the TanStack Query cache so transitions
 *      detected via polling/visibility refetch (not Realtime) STILL fire the
 *      notification. This rescues the case where the WebSocket is silently
 *      degraded (Tauri WebView suspending WS on focus loss, RLS denial without
 *      surfaced error, etc.).
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
  // we'd spam a notification on every heartbeat).
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
      console.warn(`[GlobalConversationNotifier] Reconnect in ${delay}ms (attempt ${attempt})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void subscribe();
      }, delay);
    };

    /**
     * Single source of truth for transition detection. Called from BOTH the
     * Realtime UPDATE handler and the queryCache observer below. The shadow map
     * dedupes — only the first observer to see the new status fires the toast.
     */
    const handleStatusUpdate = (row: {
      id: string;
      title?: string | null;
      analysis_status?: string | null;
    }) => {
      if (!row.id) return;

      const newStatus = row.analysis_status ?? null;
      const prevStatus = prevStatusRef.current.get(row.id) ?? null;
      const wasNonTerminal = !prevStatus || !TERMINAL_STATUSES.has(prevStatus);
      const willNotify = wasNonTerminal && newStatus === 'completed';

      // Instrumentation: log every status update considered. Reveals whether the
      // problem is "no event arrives", "shadow map already has this status", or
      // "transition detected but notify path skipped".
      logger.warn(
        `[GlobalConversationNotifier] handleStatusUpdate id=${row.id} prev=${prevStatus} new=${newStatus} willNotify=${willNotify}`,
      );

      if (prevStatus === newStatus) return; // no real change
      prevStatusRef.current.set(row.id, newStatus);

      if (willNotify) {
        notifyAnalysisComplete({ id: row.id, title: row.title }, router);
      }
      // 'failed' and 'skipped' do NOT notify. The user sees the 'Reintentar'
      // button in the detail view if they navigate there.
    };

    const handleRealtimeUpdate = (newRow: Partial<OmiConversation>) => {
      if (!newRow.id) return;

      // Invalidate so any active hook (list or detail) refetches.
      queryClient.invalidateQueries({ queryKey: ['omi-conversations', userId] });
      queryClient.invalidateQueries({ queryKey: ['omi-conversation', newRow.id] });

      handleStatusUpdate({
        id: newRow.id,
        title: newRow.title,
        analysis_status: newRow.analysis_status,
      });
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
        console.warn(`[GlobalConversationNotifier] setAuth failed: ${e instanceof Error ? e.message : String(e)}`);
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
            const newRow = payload.new as Partial<OmiConversation>;
            // Instrumentation: confirm Realtime is actually delivering UPDATE events.
            logger.warn(
              `[GlobalConversationNotifier] Realtime UPDATE id=${newRow?.id} status=${newRow?.analysis_status} title=${(newRow?.title ?? '').slice(0, 30)}`,
            );
            handleRealtimeUpdate(newRow);
          },
        )
        .subscribe((status, err) => {
          if (cleanedUp || stale) return;
          if (status === 'SUBSCRIBED') {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            attempt = 0;
            // logger.warn so it's visible without a debug filter (semantic abuse
            // for diagnosability — Realtime status is a health signal worth surfacing).
            logger.warn(`[GlobalConversationNotifier] SUBSCRIBED for user ${userId}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            stale = true;
            if (err) console.warn(`[GlobalConversationNotifier] ${status}: ${err.message}`);
            else console.warn(`[GlobalConversationNotifier] ${status}`);
            scheduleReconnect();
          }
        });

      currentChannel = channel;

      connectTimer = setTimeout(() => {
        if (cleanedUp || stale) return;
        stale = true;
        console.warn(`[GlobalConversationNotifier] Did not reach SUBSCRIBED in ${REALTIME_CONNECT_TIMEOUT_MS}ms`);
        scheduleReconnect();
      }, REALTIME_CONNECT_TIMEOUT_MS);
    };

    void subscribe();

    // Defense in depth: observe the TanStack Query cache so we ALSO catch status
    // transitions that arrive via polling, visibility refetch, or manual refetch
    // — not only via the Realtime channel. If Realtime is silently degraded, the
    // notification still fires the moment the cache reflects 'completed'.
    const cacheUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (cleanedUp) return;
      if (event.type !== 'updated') return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key.length < 2) return;

      // List query: ['omi-conversations', userId] — iterate all rows.
      if (key[0] === 'omi-conversations' && key[1] === userId) {
        const data = event.query.state.data as OmiConversation[] | undefined;
        if (!Array.isArray(data)) return;
        // Instrumentation: cache observer triggered for the list — high frequency,
        // log only count to avoid noise.
        logger.warn(`[GlobalConversationNotifier] Cache observer LIST userId=${userId} rows=${data.length}`);
        for (const conv of data) {
          if (!conv?.id) continue;
          handleStatusUpdate({
            id: conv.id,
            title: conv.title,
            analysis_status: conv.analysis_status,
          });
        }
        return;
      }

      // Detail query: ['omi-conversation', id] — single row.
      if (key[0] === 'omi-conversation' && typeof key[1] === 'string') {
        const conv = event.query.state.data as OmiConversation | undefined;
        if (!conv?.id) return;
        if (conv.user_id !== userId) return; // only notify for the current user
        // Instrumentation: cache observer triggered for a detail page.
        logger.warn(
          `[GlobalConversationNotifier] Cache observer DETAIL id=${conv.id} status=${conv.analysis_status}`,
        );
        handleStatusUpdate({
          id: conv.id,
          title: conv.title,
          analysis_status: conv.analysis_status,
        });
      }
    });

    return () => {
      cleanedUp = true;
      cacheUnsubscribe();
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
