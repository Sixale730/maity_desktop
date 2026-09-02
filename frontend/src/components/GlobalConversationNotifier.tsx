'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { isAuxWindowPath } from '@/lib/auxWindows';
import { logger } from '@/lib/logger';
import { logPoll } from '@/lib/diagnostics';
import type { OmiConversation } from '@/features/conversations/services/conversations.service';

const REALTIME_CONNECT_TIMEOUT_MS = 5_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'skipped']);
/** Throttle del invalidate de la LISTA cuando la fila actualizada no está en
 *  ninguna caché (creada en otro dispositivo): es el único caso que todavía
 *  justifica pagar un fetch completo, pero sin tope se vuelve a convertir en
 *  el mismo amplificador que este cambio existe para cortar. */
const MISSING_ROW_INVALIDATE_THROTTLE_MS = 30_000;

/**
 * Campos superficiales que sí vale la pena parchear en caliente desde
 * Realtime. Deliberadamente NO incluye los JSONB pesados
 * (`communication_feedback_v4`, `meeting_minutes_data`, `transcript_text`,
 * `events`): tocarlos aquí empezaría a decidir el shape del dato, que es
 * responsabilidad de la fase 2 de este issue. Si a una fila le falta alguno,
 * el próximo refetch real (staleTime, foco de ventana, reconexión, o el poll
 * mientras algo siga 'polling' — ver ConversationsList) los trae.
 */
const PATCHABLE_FIELDS = [
  'title',
  'overview',
  'emoji',
  'category',
  'analysis_status',
  'analysis_error_message',
  'words_count',
  'duration_seconds',
  'started_at',
  'finished_at',
  'source',
  'action_items',
] as const satisfies ReadonlyArray<keyof OmiConversation>;

/**
 * ¿Cambió algo que a la LISTA le importa mostrar? Compara solo
 * `PATCHABLE_FIELDS` — el backend escribe un heartbeat en `updated_at` cada
 * 30s mientras `analysis_status='processing'` y ese campo NUNCA debe, por sí
 * solo, disparar un parche (mucho menos un invalidate).
 */
function hasPatchableChange(prev: OmiConversation, next: Partial<OmiConversation>): boolean {
  return PATCHABLE_FIELDS.some((field) => {
    const nextVal = next[field];
    if (nextVal === undefined) return false; // Realtime no mandó esta columna
    const prevVal = prev[field];
    if (Array.isArray(prevVal) || Array.isArray(nextVal)) {
      return JSON.stringify(prevVal ?? null) !== JSON.stringify(nextVal ?? null);
    }
    return prevVal !== nextVal;
  });
}

/** Extrae solo los campos parcheables presentes en el payload de Realtime. */
function pickPatchable(row: Partial<OmiConversation>): Partial<OmiConversation> {
  const patch: Partial<OmiConversation> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (row[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = row[field];
    }
  }
  return patch;
}

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
  // IMPORTANT: maityUser.id is the FK on omi_conversations.user_id, NOT user.id
  // (Supabase auth user). The list/detail TanStack queries also use maityUser.id
  // as the second key element. Using user.id here would silently break Realtime
  // filter and queryCache observer matching.
  const { maityUser } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  // Gate de ventana auxiliar (defensa en profundidad, patrón HealthHeartbeatInitializer):
  // hoy las rutas aux no montan esta rama del layout, pero si eso cambiara habría
  // N websockets Realtime + notificaciones nativas duplicadas por ventana.
  const pathname = usePathname();
  const isAux = isAuxWindowPath(pathname);

  // Realtime payload.old can arrive empty under RLS, so we keep our own shadow
  // map of the previous status per conversation id to detect real transitions
  // (the backend writes updated_at every 30s during processing — without this
  // we'd spam a notification on every heartbeat).
  const prevStatusRef = useRef<Map<string, string | null>>(new Map());
  // Timestamp del último invalidate de lista disparado por una fila ausente
  // de la caché (ver `patchOrInvalidateList`). Vive fuera del efecto para
  // sobrevivir reconexiones del canal dentro de la misma sesión.
  const lastMissingInvalidateRef = useRef<number>(0);

  useEffect(() => {
    if (isAux) return;
    const userId = maityUser?.id;
    if (!userId) {
      prevStatusRef.current.clear();
      lastMissingInvalidateRef.current = 0;
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
      logPoll('realtime_reconnect_scheduled', { delayMs: delay, attempt });
      console.warn(`[GlobalConversationNotifier] Reconnect in ${delay}ms (attempt ${attempt})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void subscribe();
      }, delay);
    };

    /**
     * Single source of truth for transition detection. Called from BOTH the
     * Realtime UPDATE handler and the queryCache observer below.
     *
     * Critical: the FIRST observation of a conversation id is a BASELINE, not
     * a transition. Without this guard, a cold start (where the shadow map is
     * empty) fires a notification for every already-completed conversation as
     * the cache hydrates from the initial fetch — exactly the spam the global
     * notifier was supposed to prevent.
     */
    const handleStatusUpdate = (row: {
      id: string;
      title?: string | null;
      analysis_status?: string | null;
    }) => {
      if (!row.id) return;

      const newStatus = row.analysis_status ?? null;
      const hasObserved = prevStatusRef.current.has(row.id);
      const prevStatus = prevStatusRef.current.get(row.id) ?? null;
      const wasNonTerminal = !prevStatus || !TERMINAL_STATUSES.has(prevStatus);
      // Only notify on transitions observed in THIS session. First sighting
      // could be a stale 'completed' from before the app was even open.
      const willNotify = hasObserved && wasNonTerminal && newStatus === 'completed';

      if (hasObserved && prevStatus === newStatus) return; // no real change
      prevStatusRef.current.set(row.id, newStatus);

      if (willNotify) {
        logger.warn(
          `[GlobalConversationNotifier] transition id=${row.id} prev=${prevStatus} new=${newStatus} → notify`,
        );
        notifyAnalysisComplete({ id: row.id, title: row.title }, router);
      }
      // 'failed' and 'skipped' do NOT notify. The user sees the 'Reintentar'
      // button in the detail view if they navigate there.
    };

    /**
     * Parchea la(s) caché(s) de LISTA en vez de invalidarlas a ciegas.
     *
     * `getQueriesData` con un `queryKey` parcial (sin `exact: true`) matchea
     * por PREFIJO — así que si la fase 2 agrega un tercer elemento a la key
     * (el `limit`) esto sigue encontrando la caché sin cambios aquí.
     *
     * Tres casos:
     *   1. La fila está en caché y solo cambió algo que a la lista no le
     *      importa (p.ej. el heartbeat de `updated_at`) → no-op total: ni
     *      parche ni invalidate, la referencia del array se conserva.
     *   2. La fila está en caché y cambió algo de `PATCHABLE_FIELDS` → parche
     *      quirúrgico con `setQueriesData` (misma fila, resto del array intacto).
     *   3. La fila NO está en ninguna caché (creada en otro dispositivo, o la
     *      lista nunca se fetcheó) → único caso que sigue valiendo un
     *      `invalidateQueries`, throttleado a 1 cada 30s.
     *
     * La comparación va ANTES de tocar la caché a propósito: devolver `prev`
     * desde DENTRO del updater de `setQueriesData` igual dispara el evento
     * 'updated' del QueryCache, y el observer de abajo (defensa en profundidad
     * de notificaciones) volvería a iterar las N filas por nada.
     */
    const patchOrInvalidateList = (newRow: Partial<OmiConversation>) => {
      const id = newRow.id;
      if (!id) return;

      const matches = queryClient.getQueriesData<OmiConversation[]>({
        queryKey: ['omi-conversations', userId],
      });

      let found = false;
      let changed = false;
      for (const [, data] of matches) {
        if (!Array.isArray(data)) continue;
        const existing = data.find((c) => c.id === id);
        if (existing) {
          found = true;
          changed = hasPatchableChange(existing, newRow);
          break;
        }
      }

      if (found && !changed) return;

      if (found && changed) {
        const patch = pickPatchable(newRow);
        queryClient.setQueriesData<OmiConversation[]>(
          { queryKey: ['omi-conversations', userId] },
          (old) => {
            if (!Array.isArray(old)) return old;
            return old.map((c) => (c.id === id ? { ...c, ...patch } : c));
          },
        );
        return;
      }

      // No está en ninguna lista cacheada — throttleado, si no esto vuelve a
      // ser el mismo amplificador (una fila nueva en otro dispositivo puede
      // llegar seguida de varios heartbeats de UPDATE antes de asentarse).
      const now = Date.now();
      if (now - lastMissingInvalidateRef.current < MISSING_ROW_INVALIDATE_THROTTLE_MS) return;
      lastMissingInvalidateRef.current = now;
      queryClient.invalidateQueries({ queryKey: ['omi-conversations', userId] });
    };

    const handleRealtimeUpdate = (newRow: Partial<OmiConversation>) => {
      if (!newRow.id) return;

      // El detalle SIEMPRE se invalida: useConversationLive poll-ea a 3s
      // cuando el usuario está en esa vista y su watchdog necesita ver
      // avanzar `updated_at` para no disparar un reload.
      queryClient.invalidateQueries({ queryKey: ['omi-conversation', newRow.id] });

      patchOrInvalidateList(newRow);

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
            logPoll('realtime_update', {
              id: newRow?.id ?? null,
              analysis_status: newRow?.analysis_status ?? null,
              updated_at: newRow?.updated_at ?? null,
            });
            logger.warn(
              `[GlobalConversationNotifier] Realtime UPDATE id=${newRow?.id} status=${newRow?.analysis_status} title=${(newRow?.title ?? '').slice(0, 30)}`,
            );
            handleRealtimeUpdate(newRow);
          },
        )
        .subscribe((status, err) => {
          if (cleanedUp || stale) return;
          logPoll('realtime_subscribe_status', { status, error: err?.message ?? null, userId });
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
        logPoll('realtime_connect_timeout', { timeoutMs: REALTIME_CONNECT_TIMEOUT_MS, userId });
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
      // Guard barato: una query en error/pending no tiene data útil que
      // iterar, y así nos ahorramos entrar al branch de abajo en cada
      // transición de fetchStatus (loading→success dispara 'updated' igual).
      if (event.query.state.status !== 'success') return;
      if (event.type !== 'updated') return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key.length < 2) return;

      // List query: ['omi-conversations', userId] — iterate all rows.
      if (key[0] === 'omi-conversations' && key[1] === userId) {
        const data = event.query.state.data as OmiConversation[] | undefined;
        if (!Array.isArray(data)) return;
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
  }, [isAux, maityUser?.id, queryClient, router]);

  return null;
}
