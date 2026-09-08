'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { logPoll, logPollIfChanged } from '@/lib/diagnostics';
import { getOmiConversation, reanalyzeConversation } from '../services/conversations.service';
import type { OmiConversation } from '../services/conversations.service';
import { derivePhase, isTerminalPhase, type AnalysisPhase } from '../utils/derivePhase';
import { isQuotaBlocked, markQuotaBlocked, parseQuotaError } from '@/lib/quotaErrors';

const FAILED_AUTO_RETRY_DELAY_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;
const STALLED_POLL_INTERVAL_MS = 15_000;
const WATCHDOG_TICK_MS = 5_000;
const WATCHDOG_STUCK_THRESHOLD_MS = 90_000;
// Cap de reloads por sesion del browser para prevenir reload-loop si la causa
// raiz es backend (Vercel/Supabase down) en lugar de cliente envenenado.
// Patron bounded retries: Erlang OTP max_restarts, systemd StartLimitBurst,
// k8s CrashLoopBackOff, TanStack Query retry option (default 3).
// sessionStorage muere al cerrar la pestaña — cada nueva sesion arranca con cap fresco.
const WATCHDOG_RELOAD_COUNT_KEY = 'watchdog_reload_count';
const WATCHDOG_MAX_RELOADS_PER_SESSION = 3;

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
      // Sin `queryFn_start`: su única utilidad (timing) viaja como `elapsed_ms`
      // en success/error. Ambos van muestreados (#25): un poll de 3 s que no
      // cambia nada se colapsa a un latido por minuto.
      const t0 = performance.now();
      try {
        const fresh = await getOmiConversation(conversationId);
        const found = Boolean(fresh);
        const analysisStatus = fresh?.analysis_status ?? null;
        const updatedAt = fresh?.updated_at ?? null;
        const hasV4 = Boolean(fresh?.communication_feedback_v4);
        const hasMinuta = Boolean(fresh?.meeting_minutes_data);
        logPollIfChanged(
          `queryFn_success:${conversationId}`,
          'queryFn_success',
          {
            conversationId,
            found,
            analysis_status: analysisStatus,
            updated_at: updatedAt,
            has_v4: hasV4,
            has_minuta: hasMinuta,
            elapsed_ms: Math.round(performance.now() - t0),
          },
          [found, analysisStatus, updatedAt, hasV4, hasMinuta],
        );
        if (!fresh) throw new Error(`Conversation not found: ${conversationId}`);
        return fresh;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // El primer error siempre sale; uno persistente se colapsa a 1/min
        // (el patrón de tormenta de los 965 eventos del piloto Dingler).
        logPollIfChanged(
          `queryFn_error:${conversationId}`,
          'queryFn_error',
          { conversationId, error, elapsed_ms: Math.round(performance.now() - t0) },
          [error],
        );
        throw err;
      }
    },
    initialData,
    enabled,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (q) => {
      const data = q.state.data as OmiConversation | undefined;
      const phase: AnalysisPhase = data ? derivePhase(data) : 'idle';
      const next = !data
        ? POLL_INTERVAL_MS
        : isTerminalPhase(phase)
          ? false
          : phase === 'stalled'
            ? STALLED_POLL_INTERVAL_MS
            : POLL_INTERVAL_MS;
      // TanStack evalúa esta función en CADA render (useBaseQuery llama a
      // setOptions en un useEffect) y en cada cambio de estado de la query:
      // sin muestreo eran ~60-80 IPC/min con un detalle abierto (#25).
      // `fetch_status` queda fuera de la firma: alterna fetching/idle en cada
      // poll y reventaría el dedupe; sigue viajando en el payload.
      const analysisStatus = data?.analysis_status ?? null;
      const updatedAt = data?.updated_at ?? null;
      const hasV4 = Boolean(data?.communication_feedback_v4);
      const hasMinuta = Boolean(data?.meeting_minutes_data);
      const error = q.state.error?.message ?? null;
      logPollIfChanged(
        `refetchInterval_eval:${conversationId}`,
        'refetchInterval_eval',
        {
          conversationId,
          phase,
          analysis_status: analysisStatus,
          updated_at: updatedAt,
          next_interval_ms: next,
          has_v4: hasV4,
          has_minuta: hasMinuta,
          fetch_status: q.state.fetchStatus,
          error,
        },
        [phase, analysisStatus, updatedAt, next, hasV4, hasMinuta, error],
      );
      return next;
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
    if (isQuotaBlocked(conversationId)) return; // sin cuota: reintentar solo vuelve a fallar
    stuckRescueFiredRef.current = true;
    logPoll('stalled_auto_retry_dispatch', { conversationId });
    logger.info(`[useConversationLive] Stalled detected for ${conversationId}, dispatching auto-retry`);
    reanalyzeConversation(conversationId, '', 'es').catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      const quota = parseQuotaError(msg);
      if (quota) markQuotaBlocked(conversationId, quota.period);
      logPoll('stalled_auto_retry_failed', { conversationId, error: msg });
      logger.warn(`[useConversationLive] Stalled auto-retry failed: ${msg}`);
    });
  }, [enabled, phase, conversationId]);

  // Transparent failure retry: after one terminal failure, wait 60s and retry once
  // before surfacing the error to the user. Covers transient provider blips that
  // would otherwise force a manual click on "Reintentar".
  const failedRetryFiredRef = useRef(false);
  useEffect(() => {
    if (!enabled || failedRetryFiredRef.current) return;
    if (phase !== 'failed') return;
    if (isQuotaBlocked(conversationId)) return; // sin cuota: reintentar solo vuelve a fallar
    const timer = setTimeout(() => {
      failedRetryFiredRef.current = true;
      logPoll('failed_auto_retry_dispatch', { conversationId });
      logger.info(`[useConversationLive] Auto-retry after failed for ${conversationId}`);
      reanalyzeConversation(conversationId, '', 'es').catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        const quota = parseQuotaError(msg);
        if (quota) markQuotaBlocked(conversationId, quota.period);
        logPoll('failed_auto_retry_failed', { conversationId, error: msg });
        logger.warn(`[useConversationLive] Failed auto-retry failed: ${msg}`);
      });
    }, FAILED_AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, phase, conversationId]);

  // Realtime updates arrive via GlobalConversationNotifier (root layout):
  // it invalidates ['omi-conversation', id] on UPDATE; TanStack Query's
  // default refetchType: 'active' ensures this hook refetches when mounted.

  // -------------------------------------------------------------------------
  // Watchdog supervisado: si el polling no avanza en 90s, hard reload.
  //
  // Patron industrial estandar (Slack/Discord/Linear) para estados de polling
  // stuck. Es la red de seguridad para el bug intermitente "polling se queda
  // cargando, cerrar+abrir lo arregla". Mientras el bug se reproduce y los
  // logs `[POLL]` confirman la causa raiz, este watchdog evita que el usuario
  // quede colgado.
  //
  // Los logs `[POLL]` del poll van MUESTREADOS (`logPollIfChanged`, #25 de la
  // auditoria de recursos): un poll atorado se lee como latidos de
  // `refetchInterval_eval` (uno por minuto, con `suppressed`) sin ningun
  // `queryFn_success` entre medio; todo cambio de estado sigue saliendo al
  // instante.
  //
  // Resetea el contador ante cualquier signal de progreso (cambio en
  // analysis_status o updated_at). `window.location.reload()` preserva la URL
  // actual (con ?id= o ?localId=), mata el contexto JS, reinicia TanStack
  // Query, reconecta Realtime, refresca JWT — todo lo que cerrar+abrir hace.
  // -------------------------------------------------------------------------
  const lastProgressRef = useRef<number>(Date.now());
  const lastSeenStatusRef = useRef<string | null | undefined>(undefined);
  const lastSeenUpdatedAtRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const status = query.data?.analysis_status ?? null;
    const updatedAt = query.data?.updated_at ?? null;
    const changed =
      lastSeenStatusRef.current !== status ||
      lastSeenUpdatedAtRef.current !== updatedAt;
    if (changed) {
      lastSeenStatusRef.current = status;
      lastSeenUpdatedAtRef.current = updatedAt;
      lastProgressRef.current = Date.now();
    }
  }, [query.data?.analysis_status, query.data?.updated_at]);

  // Resetear el watchdog al cambiar de conversacion.
  useEffect(() => {
    lastProgressRef.current = Date.now();
    lastSeenStatusRef.current = undefined;
    lastSeenUpdatedAtRef.current = undefined;
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;
    if (isTerminalPhase(phase)) return;
    if (phase === 'idle') return;

    const tick = setInterval(() => {
      const stuckMs = Date.now() - lastProgressRef.current;
      if (stuckMs > WATCHDOG_STUCK_THRESHOLD_MS) {
        if (typeof window === 'undefined') return;
        const reloadCount = Number(sessionStorage.getItem(WATCHDOG_RELOAD_COUNT_KEY) ?? '0');
        if (reloadCount >= WATCHDOG_MAX_RELOADS_PER_SESSION) {
          logPoll('watchdog_max_reloads_reached', {
            conversationId,
            reloadCount,
            stuckMs,
            phase,
          });
          return;
        }
        logPoll('watchdog_triggered_reload', {
          conversationId,
          stuckMs,
          phase,
          reloadCount,
          analysis_status: query.data?.analysis_status ?? null,
          updated_at: query.data?.updated_at ?? null,
        });
        sessionStorage.setItem(WATCHDOG_RELOAD_COUNT_KEY, String(reloadCount + 1));
        window.location.reload();
      }
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(tick);
  }, [enabled, phase, conversationId, query.data?.analysis_status, query.data?.updated_at]);

  return {
    conversation,
    phase,
    refetch: async () => {
      const result = await query.refetch();
      return result.data;
    },
  };
}
