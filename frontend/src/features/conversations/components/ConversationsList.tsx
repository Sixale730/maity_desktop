'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { AudioLines, Clock, MessageSquare, ChevronRight, Sparkles, FileText, ListChecks, RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';
import { cloudSyncWorker } from '@/services/cloudSyncWorker';
import {
  ANALYSIS_FEATURE,
  getQuotaFeature,
  quotasActive,
  useQuotaStatus,
} from '@/hooks/usePlanStatus';
import {
  getOmiConversations,
  getLocalConversations,
  mergeConversations,
  LIST_DEFAULT_LIMIT,
  OmiConversation,
} from '../services/conversations.service';
import { useConversationsListAutoRefresh } from '../hooks/useConversationsListAutoRefresh';
import { derivePhase } from '../utils/derivePhase';

interface ConversationsListProps {
  onSelect: (conversation: OmiConversation) => void;
  selectedId?: string | null;
}

/** Estados de sync que todavía pueden cambiar solos (el loop de Rust sigue trabajando). */
const NON_TERMINAL_SYNC_STATES = new Set(['pending', 'in_progress']);

/** Texto del badge de cuota. La minuta SÍ se genera: la cuota no gatea el
 *  finalize (issue Sixale730/maity#132), solo el análisis V4. */
const QUOTA_TOOLTIP =
  'La minuta sí se genera; el análisis vuelve con tu siguiente período o con un plan superior.';

export function ConversationsList({ onSelect, selectedId }: ConversationsListProps) {
  const { maityUser } = useAuth();
  const queryClient = useQueryClient();
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  // Tope de la lista (issue #05 fase 2, D1): sube en pasos de LIST_DEFAULT_LIMIT
  // vía "Cargar más" y ENTRA en la queryKey a propósito — así cada tope tiene
  // su propia entrada de caché en vez de pisar la de 200 con una más grande
  // (que rompería el gcTime/staleTime pensado para la vista inicial).
  const [limit, setLimit] = useState(LIST_DEFAULT_LIMIT);

  // Caché compartida con PlanIndicator (misma queryKey, staleTime 60s): NO
  // agrega polling. Solo se usa para AVISAR de forma anticipada que el análisis
  // no va a llegar; el encolado y el sync siguen exactamente igual — la cuota
  // nunca corta el flujo, ni siquiera en UI.
  const { data: quotaStatus } = useQuotaStatus();
  const analysisQuotaExhausted = useMemo(() => {
    if (!quotasActive(quotaStatus)) return false;
    const feature = getQuotaFeature(quotaStatus, ANALYSIS_FEATURE);
    if (!feature || !feature.enabled) return false;
    return feature.limit !== -1 && feature.used >= feature.limit;
  }, [quotaStatus]);

  // Visibility/online safety net — invalidate the list query when the page
  // becomes visible again or the network reconnects. The Realtime push lives
  // globally in GlobalConversationNotifier (root layout) and invalidates the
  // same query on UPDATE events.
  useConversationsListAutoRefresh(maityUser?.id ?? null, limit);

  // Local data loads instantly from SQLite.
  // Privacy: queryKey includes maityUser?.id so the list refetches when the user changes
  // (login/logout). Rust filters by current_user_id from AppState — see CLAUDE.md.
  //
  // Polling floor espejo del de la nube: mientras alguna fila local tenga la
  // cola viva (pending/in_progress) se refresca cada 10s. El camino rápido es
  // el evento `sync-status-changed` (ver el efecto de abajo); esto solo cubre
  // el hueco en que el webview estuvo suspendido y se perdió el evento.
  // Se apaga solo cuando todo queda terminal (completed/failed/none).
  const { data: localConversations } = useQuery({
    queryKey: ['local-conversations', maityUser?.id],
    queryFn: () => getLocalConversations(),
    staleTime: 30_000,
    enabled: !!maityUser?.id,
    refetchInterval: (q) => {
      const data = q.state.data as OmiConversation[] | undefined;
      if (!data || data.length === 0) return false;
      const hasInFlight = data.some((c) => NON_TERMINAL_SYNC_STATES.has(c._syncState ?? 'none'));
      return hasInFlight ? 10_000 : false;
    },
  });

  // Cloud data loads in background. Polling floor: while al menos una fila
  // está en fase 'polling' (derivePhase — no el `analysis_status` crudo),
  // refetch cada 15s como fallback para cuando Realtime está degradado
  // (RLS/JWT desync, Tauri WebView suspendiendo el WS, etc). Se apaga solo
  // cuando ninguna fila sigue en 'polling'.
  //
  // Antes esto contaba `analysis_status === null` como "en vuelo": medido en
  // producción, 813 de 1,893 filas (43%) tienen `analysis_status = NULL`
  // (filas legacy sin el campo, no filas realmente procesando), así que el
  // poll de 15s quedaba prendido SIEMPRE en cualquier cuenta real, no "a
  // veces". `derivePhase` ya distingue una fila recién creada (→ 'polling')
  // de una legacy vieja sin señal (→ 'stalled', que NO reactiva el poll).
  const { data: cloudConversations, isLoading: isCloudLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['omi-conversations', maityUser?.id, { limit }],
    queryFn: () => getOmiConversations(maityUser?.id, { limit }),
    enabled: !!maityUser?.id,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: (q) => {
      const data = q.state.data as OmiConversation[] | undefined;
      if (!data || data.length === 0) return false;
      const hasInFlight = data.some((c) => derivePhase(c) === 'polling');
      return hasInFlight ? 15_000 : false;
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // El loop headless de Rust emite `cloud-sync-status-changed` en cada
  // transición y cloudSyncWorker lo reenvía al bus DOM como
  // `sync-status-changed`. Sin esto el badge de una fila local nunca se apaga
  // hasta el siguiente refetch (o hasta reabrir la app).
  useEffect(() => {
    const onSyncStatus = () => {
      void queryClient.invalidateQueries({ queryKey: ['local-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
    };
    window.addEventListener('sync-status-changed', onSyncStatus);
    return () => window.removeEventListener('sync-status-changed', onSyncStatus);
  }, [queryClient]);

  // Reintento manual de una cadena de jobs muerta: Rust revive los 'failed' del
  // meeting (incluida la descendencia marcada por la cascada) y el nudge
  // despierta al loop sin esperar su tick.
  const handleRetrySync = useCallback(
    async (meetingId: string) => {
      setRetryingIds((prev) => new Set(prev).add(meetingId));
      try {
        const revived = await invoke<number>('sync_queue_retry_meeting', { meetingId });
        logger.info('[ConversationsList] reintento de sync', { meetingId, revived });
        cloudSyncWorker.nudge();
      } catch (err) {
        logger.error('[ConversationsList] fallo al reintentar sync', err);
      } finally {
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(meetingId);
          return next;
        });
        void queryClient.invalidateQueries({ queryKey: ['local-conversations'] });
      }
    },
    [queryClient]
  );

  // Merge: local shows first, cloud enriches
  const conversations = useMemo(() => {
    const local = localConversations ?? [];
    const cloud = cloudConversations ?? [];
    if (local.length === 0 && cloud.length === 0) return [];
    if (local.length === 0) return cloud;
    if (cloud.length === 0) return local;
    return mergeConversations(local, cloud);
  }, [localConversations, cloudConversations]);

  const isLoading = !localConversations && isCloudLoading;

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /**
   * Badge de sync de una fila. Salvo el de cuota (que vale para cualquier
   * fila), solo aplica a filas LOCALES no fusionadas: si
   * `mergeConversations` la unió con su gemela de la nube, el spread descarta
   * `_syncState` y el estado lo cuenta `analysis_status` (derivePhase).
   *
   * Antes esto era `source==='local' && !communication_feedback_v4`, que es
   * decir "sincronizando" para siempre a cualquier fila sin análisis en la
   * nube — incluida una con el sync completo o muerto hace horas.
   */
  const renderSyncBadge = (conversation: OmiConversation) => {
    // Cuota agotada según la NUBE (finalize 200 con `analysis_status`
    // 'quota_skipped'). Va antes del guard de `source` porque aplica igual a la
    // fila local — que lo recibe vía `api_get_meetings_overview` — y a la
    // fusionada, donde el valor viene de `omi_conversations`.
    if (conversation.analysis_status === 'quota_skipped') {
      return (
        <Badge
          variant="outline"
          className="text-xs gap-1 text-amber-600 border-amber-300"
          title={QUOTA_TOOLTIP}
        >
          <AlertTriangle className="h-3 w-3" />
          Cuota agotada
        </Badge>
      );
    }

    if (conversation.source !== 'local') return null;
    const state = conversation._syncState ?? 'none';

    if (NON_TERMINAL_SYNC_STATES.has(state)) {
      // El sync SÍ está ocurriendo (datos y minuta suben igual), así que
      // "Sincronizando…" se mantiene. Cuando la caché de cuota ya dice que el
      // período está agotado se agrega un segundo badge chico anticipando que
      // el análisis no vendrá — sin cambiar nada del flujo de sync.
      return (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Sincronizando...
          </Badge>
          {analysisQuotaExhausted && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 text-amber-600/80 border-amber-300/60"
              title={QUOTA_TOOLTIP}
            >
              Sin análisis (cuota)
            </Badge>
          )}
        </div>
      );
    }

    if (state !== 'failed') return null;

    // Cuota agotada: no es un error del usuario ni algo que reintentar sirva de
    // nada, así que va en ámbar y sin botón. El caso normal (finalize 200 con
    // `analysis_status='quota_skipped'`) ya se resolvió arriba; esto cubre los
    // jobs LEGACY que murieron con el 403 `quota:`.
    if (conversation._syncError?.startsWith('quota:')) {
      return (
        <Badge
          variant="outline"
          className="text-xs gap-1 text-amber-600 border-amber-300"
          title={QUOTA_TOOLTIP}
        >
          <AlertTriangle className="h-3 w-3" />
          Cuota agotada
        </Badge>
      );
    }

    const meetingId = conversation._localId ?? conversation.id;
    const isRetrying = retryingIds.has(meetingId);

    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs gap-1 text-destructive border-destructive/40">
          <AlertTriangle className="h-3 w-3" />
          Error de sincronización
        </Badge>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleRetrySync(meetingId);
          }}
          disabled={isRetrying}
          className="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
          title={conversation._syncError ?? 'Reintentar sincronización'}
        >
          {isRetrying ? 'Reintentando...' : 'Reintentar'}
        </button>
      </div>
    );
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
          <AudioLines className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Conversaciones</h1>
          <p className="text-muted-foreground">Tu historial de conversaciones</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          title="Actualizar lista"
        >
          <RefreshCw className={`h-5 w-5 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center text-destructive">
            Error al cargar las conversaciones
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !error && conversations?.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <AudioLines className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2 text-foreground">No hay conversaciones</h3>
            <p className="text-muted-foreground">Tus conversaciones aparecerán aquí</p>
          </CardContent>
        </Card>
      )}

      {/* Conversations list */}
      {!isLoading && conversations && conversations.length > 0 && (
        <div className="space-y-3">
          {conversations.map((conversation) => (
            <Card
              key={conversation.id}
              className={`cursor-pointer hover:shadow-md transition-all ${
                selectedId === conversation.id
                  ? 'border-primary ring-1 ring-primary'
                  : 'hover:border-primary/30'
              }`}
              onClick={() => onSelect(conversation)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {conversation.emoji && (
                        <span className="text-lg">{conversation.emoji}</span>
                      )}
                      <h3 className="font-medium truncate text-foreground">{conversation.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {conversation.overview}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Duración: {formatDuration(conversation.duration_seconds)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {conversation.words_count || 0} palabras
                      </span>
                      <span>{formatDate(conversation.started_at ?? conversation.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {renderSyncBadge(conversation)}
                    {conversation.category && (
                      <Badge variant="secondary" className="text-xs">
                        {conversation.category}
                      </Badge>
                    )}
                    {conversation._listHasMinuta && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <FileText className="h-3 w-3" />
                        Minuta
                      </Badge>
                    )}
                    {conversation.action_items && conversation.action_items.length > 0 && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <ListChecks className="h-3 w-3" />
                        Tareas ({conversation.action_items.length})
                      </Badge>
                    )}
                    {/* Issue #05 fase 2: `_listAnalysis` viene resuelto del query
                        (proyección ligera) — reemplaza a isFullAnalysis/isAnalysisSkipped,
                        que operarían sobre communication_feedback_v4=null y siempre darían falso. */}
                    {conversation._listAnalysis === 'full' && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Sparkles className="h-3 w-3" />
                        Análisis
                      </Badge>
                    )}
                    {conversation._listAnalysis === 'skipped' && (
                      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                        Sin análisis
                      </Badge>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {/* "Cargar más" (issue #05 fase 2, D1): solo cuando la nube devolvió
              exactamente `limit` filas — señal de que puede haber más detrás.
              Sin cursor a propósito: created_at no es estable para paginar con
              updated_at, y refetchear 200 filas ligeras en una acción explícita
              del usuario es más barato que useInfiniteQuery. */}
          {cloudConversations && cloudConversations.length === limit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setLimit((l) => l + LIST_DEFAULT_LIMIT)}
                disabled={isFetching}
                className="text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {isFetching ? 'Cargando...' : 'Cargar más'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
