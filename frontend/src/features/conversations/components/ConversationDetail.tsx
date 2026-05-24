'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Analytics from '@/lib/analytics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, MessageSquare, Calendar, Sparkles, X, RefreshCw, Loader2, FileText, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  OmiConversation,
  getOmiTranscriptSegments,
  getLocalMeetingDetail,
  reanalyzeConversation,
  toggleActionItemCompleted,
  isAnalysisSkipped,
  isFullAnalysis,
  isMeetingMinutesV2,
} from '../services/conversations.service';
import { useConversationLive } from '../hooks/useConversationLive';
import { derivePhase } from '../utils/derivePhase';
import { AnalysisStatusBanner } from './AnalysisStatusBanner';
import { SessionFeedbackModal } from '@/components/recording/SessionFeedbackModal';
import { TranscriptSection } from './analysis';
import { ResumenHero as ResumenHeroV1 } from './analysis/dashboard-v1/ResumenHero';
import { TuRadarCard } from './analysis/dashboard-v1/TuRadarCard';
import { KPIGrid } from './analysis/dashboard-v1/KPIGrid';
import { InsightsGrid } from './analysis/dashboard-v1/InsightsGrid';
import { HallazgosSection } from './analysis/dashboard-v1/HallazgosSection';
import { RecomendacionesSection as RecomendacionesSectionV1 } from './analysis/dashboard-v1/RecomendacionesSection';
import { CapaLabel } from './analysis/dashboard-v1/CapaLabel';
import { cloudV4ToDashboardV1 } from './analysis/dashboard-v1/adapter';
import { MinutaDashboardV1 } from './analysis/dashboard-v1/MinutaDashboardV1';
import { MinutaDashboardV2 } from './minuta-v2';
import './analysis/dashboard-v1/dashboard.css';
import { normalizeMeetingMinutes } from '../utils/normalize-meeting-minutes';
import { isMinutaInsufficient } from '../utils/minuta-helpers';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

interface ConversationDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
  onConversationUpdate?: (updated: OmiConversation) => void;
  /** Hint from parent that this convo just finished recording. Only used while
   * the row may not yet exist in Supabase (local-only); for cloud rows the
   * authoritative state comes from `useConversationLive` and this is ignored. */
  isAnalyzing?: boolean;
}

function buildTranscriptText(segments: { is_user: boolean | null; text: string }[]): string {
  return segments
    .map((s) => {
      const speaker = s.is_user ? 'Usuario' : 'Interlocutor';
      return `${speaker}: ${s.text}`;
    })
    .join('\n');
}

/** Map raw speaker keys ("user", "interlocutor") to display names using auth + minuta data */
function buildSpeakerNameMap(
  userName: string | undefined,
  minutaParticipantes: { nombre: string; rol: string; presente: boolean }[] | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (userName) map['user'] = userName;

  if (minutaParticipantes && minutaParticipantes.length > 0) {
    const GENERIC = new Set(['user', 'usuario', 'tú', 'yo', 'unknown', 'desconocido']);
    const userFirst = userName?.split(' ')[0]?.toLowerCase();
    const interlocutor = minutaParticipantes.find((p) => {
      const n = p.nombre.toLowerCase();
      if (GENERIC.has(n)) return false;
      if (userFirst && n.includes(userFirst)) return false;
      return true;
    });
    if (interlocutor) map['interlocutor'] = interlocutor.nombre;
  }
  return map;
}

export function ConversationDetail({ conversation: initialConversation, onClose, onConversationUpdate, isAnalyzing }: ConversationDetailProps) {
  const isLocalOnly = initialConversation.source === 'local';
  const conversationId = initialConversation.id;

  // For local-only convos (not yet in Supabase) we keep state locally and fetch
  // the transcript from SQLite. For cloud convos, useConversationLive is the
  // single source of truth: TanStack Query + Realtime hint with auto-reconnect
  // + 3s polling floor (15s when stalled) + visibility/online refetch.
  const [localConversation, setLocalConversation] = useState(initialConversation);
  const live = useConversationLive(conversationId, isLocalOnly ? undefined : initialConversation, !isLocalOnly);

  const conversation = isLocalOnly ? localConversation : live.conversation;

  const [copied, setCopied] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackMeetingId, setFeedbackMeetingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { maityUser } = useAuth();

  // Si la grabacion recien terminada apunta a esta conversation, mostrar
  // modal de feedback como overlay sin bloquear el polling de evaluacion.
  useEffect(() => {
    const pending = sessionStorage.getItem('feedback_pending_meeting_id');
    if (!pending) return;
    const localId = conversation._localId || conversation.id;
    if (pending === localId) {
      setFeedbackMeetingId(pending);
      setShowFeedbackModal(true);
      sessionStorage.removeItem('feedback_pending_meeting_id');
    }
  }, [conversation._localId, conversation.id]);

  const handleFeedbackClose = useCallback(() => {
    setShowFeedbackModal(false);
    setFeedbackMeetingId(null);
  }, []);

  // Notify parent when the live query produces fresher data.
  const lastNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLocalOnly || !onConversationUpdate) return;
    const fingerprint = `${conversation.analysis_status ?? ''}|${conversation.communication_feedback_v4 ? 'v4' : ''}|${conversation.meeting_minutes_data ? 'm' : ''}|${conversation.title}`;
    if (lastNotifiedRef.current === fingerprint) return;
    lastNotifiedRef.current = fingerprint;
    onConversationUpdate(conversation);
  }, [isLocalOnly, conversation, onConversationUpdate]);

  // Toast when phase reaches completed (only fires once per conversationId).
  const completedToastedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLocalOnly) return;
    if (live.phase !== 'completed') return;
    if (completedToastedRef.current === conversationId) return;
    completedToastedRef.current = conversationId;
    toast.success('Análisis completado');
  }, [isLocalOnly, live.phase, conversationId]);

  // Local transcript hydration — fetch from SQLite when needed.
  useEffect(() => {
    if (!isLocalOnly || localConversation.transcript_text) return;
    const localId = localConversation._localId || localConversation.id;
    getLocalMeetingDetail(localId).then((detail) => {
      if (detail?.transcript_text) {
        setLocalConversation((prev) => ({ ...prev, transcript_text: detail.transcript_text }));
      }
    }).catch((err) => console.warn('Error fetching local transcript detail:', err));
  }, [isLocalOnly, localConversation._localId, localConversation.id, localConversation.transcript_text]);

  // Banner phase: cloud comes from derived state; local relies on parent's
  // `isAnalyzing` hint until the row exists in Supabase and we switch to live.
  const phase = isLocalOnly ? (isAnalyzing ? 'polling' : 'idle') : live.phase;
  const isAnalysisActive = phase === 'polling' || phase === 'stalled';

  const { data: segments, isLoading: loadingSegments, error: segmentsError } = useQuery({
    queryKey: ['omi-segments', conversation.id],
    queryFn: () => getOmiTranscriptSegments(conversation.id),
    enabled: !isLocalOnly, // Skip Supabase fetch for local-only conversations
    retry: 1, // Only retry once to avoid long loading states
    staleTime: 1000 * 60 * 5, // Cache for 5 min
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (transcriptText: string) =>
      reanalyzeConversation(conversation.id, transcriptText, conversation.language || 'es'),
    onMutate: () => {
      if (isLocalOnly) {
        setLocalConversation((prev) => ({ ...prev, analysis_status: 'processing' as const }));
      } else {
        // Optimistic update of the live cache; useConversationLive will reconcile.
        queryClient.setQueryData<OmiConversation>(['omi-conversation', conversationId], (old) =>
          old ? { ...old, analysis_status: 'processing' as const } : old,
        );
      }
    },
    onSuccess: (updated) => {
      if (isLocalOnly) {
        setLocalConversation((prev) => ({ ...prev, ...updated, analysis_status: 'processing' as const }));
      } else {
        queryClient.setQueryData<OmiConversation>(['omi-conversation', conversationId], (old) => ({
          ...(old ?? updated),
          ...updated,
          analysis_status: 'processing' as const,
        }));
        // Invalidate so the polling floor immediately picks up the new state.
        queryClient.invalidateQueries({ queryKey: ['omi-conversation', conversationId] });
      }
      onConversationUpdate?.(updated);
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
      // Reset the completed-toast guard so the next completion fires it again.
      completedToastedRef.current = null;
      toast.info('Reanálisis iniciado. Te avisaremos cuando esté listo.');
    },
    onError: (error: Error) => {
      if (isLocalOnly) {
        setLocalConversation((prev) =>
          prev.analysis_status === 'processing' ? { ...prev, analysis_status: null } : prev,
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ['omi-conversation', conversationId] });
      }
      toast.error('Error al analizar', { description: error.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ index, completed }: { index: number; completed: boolean }) =>
      toggleActionItemCompleted(conversation.id, index, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
      toast.success('Tarea actualizada');
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar tarea', { description: error.message });
    },
  });

  const handleReanalyze = () => {
    let text = '';
    if (segments && segments.length > 0) {
      text = buildTranscriptText(segments);
    } else if (conversation.transcript_text) {
      text = conversation.transcript_text;
    }
    if (!text) {
      toast.error('Sin transcripcion disponible para analizar');
      return;
    }
    reanalyzeMutation.mutate(text);
  };

  // Stalled retry: refetch first, only re-trigger analysis if the row
  // still isn't done. Avoids burning an OpenAI call when the backend
  // already finished but the client got stuck.
  const handleRetryStalled = async () => {
    if (isLocalOnly) {
      handleReanalyze();
      return;
    }
    const fresh = await live.refetch();
    if (!fresh) {
      handleReanalyze();
      return;
    }
    const freshPhase = derivePhase(fresh);
    if (freshPhase === 'completed' || freshPhase === 'skipped') return;
    handleReanalyze();
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const feedbackV4Raw = conversation.communication_feedback_v4;
  const feedbackV4 = isFullAnalysis(feedbackV4Raw) ? feedbackV4Raw : null;
  const hasAnalysis = !!feedbackV4;
  const analysisSkipped = isAnalysisSkipped(feedbackV4Raw);
  const minutaData = conversation.meeting_minutes_data;
  const hasMinuta = !!minutaData;

  // Tabs control + jump-to-transcript desde la minuta v2. El nonce garantiza
  // que clicks repetidos en el mismo segment_ref re-disparen scroll+pulso
  // (un `setTargetSegment(prev=prev)` con el mismo index seria no-op en React).
  const [activeTab, setActiveTab] = useState<string>('analisis');
  const [targetSegment, setTargetSegment] = useState<{ index: number; nonce: number } | null>(null);

  const handleJumpToSegment = useCallback((segmentIndex: number) => {
    setActiveTab('transcripcion');
    setTargetSegment((prev) => ({ index: segmentIndex, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const detailViewTracked = useRef(false);
  const analysisViewTracked = useRef(false);

  useEffect(() => {
    if (!detailViewTracked.current) {
      detailViewTracked.current = true;
      const meetingId = conversation._localId ?? conversation.id;
      Analytics.track('conversation_detail_viewed', {
        meeting_id: meetingId,
        source: conversation.source ?? 'unknown',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasAnalysis && !analysisViewTracked.current) {
      analysisViewTracked.current = true;
      Analytics.track('analysis_viewed', {
        meeting_id: conversation._localId ?? conversation.id,
        has_v4: 'true',
        has_minuta: hasMinuta.toString(),
      });
    }
  }, [hasAnalysis, hasMinuta, conversation._localId, conversation.id]);

  const canAnalyze = !reanalyzeMutation.isPending && !loadingSegments &&
    ((segments && segments.length > 0) || !!conversation.transcript_text);
  // speakerNameMap removed: lo usaban solo los componentes V4 viejos. El
  // Dashboard V1 no lo necesita. buildSpeakerNameMap se conserva por si se
  // re-introducen perfiles emocionales en el futuro.
  void buildSpeakerNameMap;

  const truncateId = (id: string) =>
    id.length > 14 ? `${id.slice(0, 6)}...${id.slice(-6)}` : id;

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(conversation.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [conversation.id]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-background">
      {/* Close button */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div className="flex items-center gap-2">
          {reanalyzeMutation.isPending || isAnalysisActive ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analizando...
            </Button>
          ) : hasAnalysis ? (
            <Button variant="outline" size="sm" onClick={handleRetryStalled} disabled={!canAnalyze}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reanalizar
            </Button>
          ) : analysisSkipped ? (
            null /* Don't show retry button — insufficient data won't produce a different result */
          ) : phase === 'failed' ? (
            /* Only show the retry button once failure is confirmed by the backend.
             * For idle/unknown states, hide it to avoid users double-firing analyses. */
            <Button size="sm" onClick={handleRetryStalled} disabled={!canAnalyze}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar análisis
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {conversation.emoji && <span className="text-3xl">{conversation.emoji}</span>}
          <h1 className="text-2xl font-bold text-foreground">{conversation.title}</h1>
        </div>
        <p className="text-muted-foreground mb-4">{conversation.overview}</p>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {formatDate(conversation.started_at ?? conversation.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            Duración: {formatDuration(conversation.duration_seconds)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {conversation.words_count || 0} palabras
          </span>
          {conversation.category && <Badge variant="secondary">{conversation.category}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span className="font-mono">ID: {truncateId(conversation.id)}</span>
          <button
            onClick={handleCopyId}
            className="p-0.5 rounded hover:bg-muted transition-colors"
            title="Copiar ID completo"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Analysis status banner */}
      <AnalysisStatusBanner
        phase={phase}
        onRetry={canAnalyze ? handleRetryStalled : undefined}
      />

      {/* 3 Tabs: Análisis + Minuta + Transcripción */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="analisis" className="flex-1 gap-2">
            <Sparkles className="h-4 w-4" />
            Análisis
          </TabsTrigger>
          <TabsTrigger value="minuta" className="flex-1 gap-2">
            <FileText className="h-4 w-4" />
            Minuta
          </TabsTrigger>
          <TabsTrigger value="transcripcion" className="flex-1 gap-2">
            <MessageSquare className="h-4 w-4" />
            Transcripción
          </TabsTrigger>
        </TabsList>

        {/* Tab: Análisis (Dashboard V1) */}
        <TabsContent value="analisis">
          {reanalyzeMutation.isPending || conversation.analysis_status === 'processing' ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                <h3 className="text-lg font-medium mb-2 text-foreground">Reanalizando…</h3>
                <p className="text-muted-foreground">
                  Estamos generando un nuevo análisis. Esto puede tardar 30-60 segundos.
                </p>
              </CardContent>
            </Card>
          ) : hasAnalysis && feedbackV4 ? (
            (() => {
              const data = cloudV4ToDashboardV1(feedbackV4);
              return (
            <div className="dashboard-v1-scope space-y-4 py-2">
              <ResumenHeroV1 feedback={data} />
              <TuRadarCard feedback={data} />
              <CapaLabel text="Radiografía Rápida" />
              <KPIGrid feedback={data} />
              <CapaLabel text="Lo Que Quizás No Notaste" />
              <InsightsGrid feedback={data} />
              <CapaLabel text="Capa 2 — Hallazgos Detallados" />
              <HallazgosSection feedback={data} />
              <CapaLabel text="Top 3 Recomendaciones" />
              <RecomendacionesSectionV1 feedback={data} />

              {/* Action Items (if present) */}
              {conversation.action_items && conversation.action_items.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">Tareas</h3>
                  <ul className="space-y-3">
                    {conversation.action_items.map((item, i) => (
                      <li key={i} className={`flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-opacity duration-300 ${item.completed ? 'opacity-50' : 'opacity-100'}`}>
                        <input
                          type="checkbox"
                          checked={item.completed ?? false}
                          onChange={() =>
                            toggleMutation.mutate({ index: i, completed: !(item.completed ?? false) })
                          }
                          disabled={toggleMutation.isPending}
                          className="mt-1 h-5 w-5 rounded border-border accent-primary cursor-pointer hover:scale-110 transition-transform"
                        />
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm transition-all duration-300 ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                            {item.description}
                          </span>
                          {(item.priority || item.assignee) && (
                            <div className="flex items-center gap-2 mt-1">
                              {item.priority && (
                                <Badge variant="secondary" className="text-xs">
                                  {item.priority}
                                </Badge>
                              )}
                              {item.assignee && (
                                <span className="text-xs text-muted-foreground">{item.assignee}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
              );
            })()
          ) : analysisSkipped ? (
            /* Analysis was skipped due to insufficient data */
            <Card>
              <CardContent className="p-12 text-center">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2 text-foreground">Conversación muy corta para analizar</h3>
                <p className="text-muted-foreground">
                  {isAnalysisSkipped(feedbackV4Raw) && feedbackV4Raw.user_words != null
                    ? `Se detectaron ${feedbackV4Raw.user_words} palabras del usuario (mínimo requerido: ${feedbackV4Raw.min_required ?? 15}).`
                    : 'La transcripción del usuario no tiene suficientes palabras para generar un análisis significativo.'}
                </p>
                <p className="text-muted-foreground text-sm mt-2">
                  La minuta de la reunión sigue disponible en la pestaña correspondiente.
                </p>
              </CardContent>
            </Card>
          ) : (
            /* No analysis yet */
            <Card>
              <CardContent className="p-12 text-center">
                {isAnalysisActive ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Analizando con Maity...</h3>
                    <p className="text-muted-foreground">Las métricas se mostrarán automáticamente</p>
                  </>
                ) : phase === 'failed' ? (
                  /* Confirmed failure — show the retry button. handleRetryStalled
                   * refetches first and only re-fires if the row is still
                   * non-terminal, so multiple clicks are safe. */
                  <>
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">El análisis falló</h3>
                    <p className="text-muted-foreground mb-4">Reintenta para generar las métricas de comunicación</p>
                    {reanalyzeMutation.isPending ? (
                      <Button disabled>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analizando...
                      </Button>
                    ) : (
                      <Button onClick={handleRetryStalled} disabled={!canAnalyze}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reintentar análisis
                      </Button>
                    )}
                  </>
                ) : (
                  /* Idle / unknown / waiting — passive state, no button to avoid
                   * users double-firing while the system catches up. */
                  <>
                    <Loader2 className="h-12 w-12 mx-auto text-muted-foreground mb-4 animate-spin" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Esperando análisis</h3>
                    <p className="text-muted-foreground">El análisis aún no está disponible para esta conversación</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Minuta */}
        <TabsContent value="minuta">
          {hasMinuta && minutaData ? (
            () => {
              const nm = normalizeMeetingMinutes(minutaData);
              const userName = maityUser?.first_name ?? undefined;

              // Red de seguridad: si algun subcomponente encuentra un edge
              // case y crashea, el ErrorBoundary lo contiene en el tab y no
              // rompe toda la pagina /conversations.
              const minutaErrorFallback = (
                <Card>
                  <CardContent className="p-12 text-center">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">
                      No pudimos renderizar la minuta
                    </h3>
                    <p className="text-muted-foreground">
                      Los datos parciales estan guardados en la conversacion. Si el problema
                      persiste, exporta los logs desde Configuración para reportarlo.
                    </p>
                  </CardContent>
                </Card>
              );

              // v2 (Fireflies-style): nuevo dashboard con TL;DR + keywords + chapters + jump-to-transcript.
              if (isMeetingMinutesV2(nm)) {
                return (
                  <ErrorBoundary fallback={minutaErrorFallback}>
                    <MinutaDashboardV2 minuta={nm} onJumpToSegment={handleJumpToSegment} />
                  </ErrorBoundary>
                );
              }

              // v1 legacy: si todos los campos clave estan vacios, mostrar
              // placeholder generico en vez de un render parcial que crashea.
              if (isMinutaInsufficient(nm)) {
                return (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2 text-foreground">
                        Conversación muy corta para generar minuta
                      </h3>
                      <p className="text-muted-foreground">
                        La minuta se genera cuando hay decisiones, acciones o temas suficientes
                        para resumir. Intenta con una conversación más larga.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <ErrorBoundary fallback={minutaErrorFallback}>
                  <div className="dashboard-v1-scope">
                    <MinutaDashboardV1 minuta={nm} userName={userName} />
                  </div>
                </ErrorBoundary>
              );
            }
          )() : (
            <Card>
              <CardContent className="p-12 text-center">
                {isAnalysisActive ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Generando minuta...</h3>
                    <p className="text-muted-foreground">La minuta se mostrará automáticamente</p>
                  </>
                ) : (
                  <>
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Sin minuta disponible</h3>
                    <p className="text-muted-foreground">La minuta se genera automáticamente al analizar la conversación</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Transcripción */}
        <TabsContent value="transcripcion">
          <Card>
            <CardContent className="p-0">
              <TranscriptSection
                segments={segments}
                loading={loadingSegments && !segmentsError}
                fallbackText={conversation.transcript_text}
                userName={maityUser?.first_name ?? undefined}
                error={segmentsError ? String(segmentsError) : undefined}
                highlightedSegment={targetSegment}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal de feedback de sesion. Aparece solo si la grabacion recien
          terminada apunta a esta conversation. No bloquea el polling de
          evaluacion — solo es un overlay visible. */}
      <SessionFeedbackModal
        open={showFeedbackModal}
        meetingId={feedbackMeetingId}
        onSubmit={handleFeedbackClose}
      />
    </div>
  );
}
