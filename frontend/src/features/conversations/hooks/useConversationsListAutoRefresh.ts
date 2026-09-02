'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LIST_DEFAULT_LIMIT } from '../services/conversations.service';

/** Debajo de este umbral, el dato ya se consideró "reciente" por otra vía
 *  (fetch normal, patch de GlobalConversationNotifier, otro alt-tab) y no
 *  vale la pena pagar un fetch más. */
const STALE_AGE_FOR_REFRESH_MS = 60_000;

/**
 * Force-invalidate the cloud conversations list query when the page becomes
 * visible again or the network reconnects. The Realtime subscription is now
 * owned by GlobalConversationNotifier at the root layout, which invalidates
 * the same query on UPDATE events. This hook is the secondary safety net for
 * when Realtime is silently degraded (Tauri WebView suspending WS on focus
 * loss, network blips, etc.).
 *
 * The list query (`['omi-conversations', userId, { limit }]`) does the actual
 * refetch; this hook only emits invalidations.
 *
 * `invalidateQueries` ignora `staleTime` — sin este gate, CADA alt-tab y
 * CADA reconexión forzaban un fetch real, así que la query ya tenía
 * `refetchOnWindowFocus` cubriendo el caso normal y este hook duplicaba el
 * fetch además de saltarse el staleTime. Ahora solo invalida si el dato
 * lleva más de `STALE_AGE_FOR_REFRESH_MS` sin refrescarse.
 *
 * `limit` (issue #05 fase 2, D1): `getQueryState` hace match EXACTO de la
 * queryKey (a diferencia de `invalidateQueries`, que matchea por prefijo) —
 * sin el tercer elemento, la key nunca encontraría la entrada real de
 * `ConversationsList` (que ahora es `[..., { limit }]`) y `state` sería
 * SIEMPRE `undefined`, forzando un invalidate en cada alt-tab/reconexión
 * (justo el thundering-herd que este hook existe para evitar).
 */
export function useConversationsListAutoRefresh(
  userId: string | null | undefined,
  limit: number = LIST_DEFAULT_LIMIT
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const queryKey = ['omi-conversations', userId, { limit }];

    const invalidateIfStale = () => {
      const state = queryClient.getQueryState(queryKey);
      const age = Date.now() - (state?.dataUpdatedAt ?? 0);
      if (age <= STALE_AGE_FOR_REFRESH_MS) return;
      queryClient.invalidateQueries({ queryKey });
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        invalidateIfStale();
      }
    };
    const onOnline = () => {
      invalidateIfStale();
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
  }, [userId, limit, queryClient]);
}
