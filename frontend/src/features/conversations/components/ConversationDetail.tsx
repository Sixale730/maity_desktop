'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, MessageSquare, Calendar, Sparkles, X, RefreshCw, Loader2, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  OmiConversation,
  getOmiTranscriptSegments,
  getOmiConversation,
  getLocalMeetingDetail,
  reanalyzeConversation,
  toggleActionItemCompleted,
  isAnalysisSkipped,
  isFullAnalysis,
} from '../services/conversations.service';
import {
  ResumenHero,
  TuRadarCard,
  EmotionProfiles,
  KPIGrid,
  PatronCard,
  InsightsGrid,
  HallazgosSection,
  PuertasDetalleSection,
  RecomendacionesSection,
  RealTimelineChart,
  TranscriptSection,
} from './analysis';
import {
  MinutaHeroSummary,
  MinutaKPIStrip,
  MinutaGauge,
  MinutaEfectividad,
  MinutaDecisions,
  MinutaActions,
  MinutaIncompleteActions,
  MinutaSeguimiento,
} from './minuta';
import { normalizeMeetingMinutes } from '../utils/normalize-meeting-minutes';

interface ConversationDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
  onConversationUpdate?: (updated: OmiConversation) => void;
  isAnalyzing?: boolean;
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-8 mb-3 pl-1 flex items-center gap-2">
      <div className="h-px flex-1 border-t border-border" />
      <span>{text}</span>
      <div className="h-px flex-1 border-t border-border" />
    </div>
  );
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
  const [conversation, setConversation] = useState(initialConversation);
  const [isWaitingForAnalysis, setIsWaitingForAnalysis] = useState(isAnalyzing ?? false);
  const queryClient = useQueryClient();
  const { maityUser } = useAuth();
  const prevAnalysisRef = useRef({ hadV4: !!initialConversation.communication_feedback_v4, hadMinutes: !!initialConversation.meeting_minutes_data });

  // Poll for analysis completion when isAnalyzing is true.
  // V4 and minutes now run in separate Vercel runtimes, so they may arrive at different times.
  // Update state on each partial result; stop polling when both are present or timeout (300s).
  // Skip polling for local-only conversations (no Supabase record to poll).
  useEffect(() => {
    if (!isWaitingForAnalysis || conversation.source === 'local') return;
    const interval = setInterval(async () => {
      try {
        const updated = await getOmiConversation(conversation.id);
        if (!updated) return;
        const hasV4 = isFullAnalysis(updated.communication_feedback_v4) || isAnalysisSkipped(updated.communication_feedback_v4);
        const hasMinutes = !!updated.meeting_minutes_data;
        const prev = prevAnalysisRef.current;

        // Update conversation state whenever new data arrives
        if ((hasV4 && !prev.hadV4) || (hasMinutes && !prev.hadMinutes)) {
          prevAnalysisRef.current = { hadV4: hasV4, hadMinutes: hasMinutes };
          setConversation(updated);
          onConversationUpdate?.(updated);
          queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
        }

        // Stop polling when both analyses are complete
        if (hasV4 && hasMinutes) {
          setIsWaitingForAnalysis(false);
          toast.success('Análisis completado');
        }
      } catch (err) {
        console.warn('Error polling for analysis:', err);
      }
    }, 5000);
    const timeout = setTimeout(() => {
      setIsWaitingForAnalysis(false);
      toast.info('El análisis está tardando. Puedes reanalizar manualmente.');
    }, 300000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [isWaitingForAnalysis, conversation.id, onConversationUpdate, queryClient]);

  // Listen for finalize-completed event from useRecordingStop fire-and-forget.
  // Now that finalize uses waitUntil (fire-and-forget), this event arrives BEFORE
  // analyses complete. Only stop polling if both results are already present.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId === conversation.id) {
        try {
          const updated = await getOmiConversation(conversation.id);
          if (updated) {
            setConversation(updated);
            onConversationUpdate?.(updated);
            queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
            const bothDone = (isFullAnalysis(updated.communication_feedback_v4) || isAnalysisSkipped(updated.communication_feedback_v4)) && !!updated.meeting_minutes_data;
            if (bothDone) {
              setIsWaitingForAnalysis(false);
            } else {
              // Finalize returned but analyses are still processing — start/keep polling
              setIsWaitingForAnalysis(true);
            }
          }
        } catch (err) {
          console.warn('Error refetching after finalize-completed:', err);
        }
      }
    };
    window.addEventListener('finalize-completed', handler);
    return () => window.removeEventListener('finalize-completed', handler);
  }, [conversation.id, onConversationUpdate, queryClient]);

  const isLocalOnly = conversation.source === 'local';

  // For local conversations selected from the list, transcript_text may be null.
  // Fetch the full detail (with transcript) from SQLite.
  useEffect(() => {
    if (!isLocalOnly || conversation.transcript_text) return;
    const localId = conversation._localId || conversation.id;
    getLocalMeetingDetail(localId).then((detail) => {
      if (detail?.transcript_text) {
        setConversation((prev) => ({ ...prev, transcript_text: detail.transcript_text }));
      }
    }).catch((err) => console.warn('Error fetching local transcript detail:', err));
  }, [isLocalOnly, conversation._localId, conversation.id, conversation.transcript_text]);

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
    onSuccess: (updated) => {
      setConversation(updated);
      onConversationUpdate?.(updated);
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
      toast.info('Reanálisis iniciado. Te avisaremos cuando esté listo.');
      // Reset ref so polling detects the NEW results, not old ones
      prevAnalysisRef.current = { hadV4: false, hadMinutes: false };
      setIsWaitingForAnalysis(true);
    },
    onError: (error: Error) => {
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
  const canAnalyze = !reanalyzeMutation.isPending && !loadingSegments &&
    ((segments && segments.length > 0) || !!conversation.transcript_text);
  const speakerNameMap = buildSpeakerNameMap(
    maityUser?.first_name ?? undefined,
    minutaData?.meta?.participantes,
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-background">
      {/* Close button */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div className="flex items-center gap-2">
          {reanalyzeMutation.isPending || isWaitingForAnalysis ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analizando...
            </Button>
          ) : hasAnalysis ? (
            <Button variant="outline" size="sm" onClick={handleReanalyze} disabled={!canAnalyze}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reanalizar
            </Button>
          ) : analysisSkipped ? (
            null /* Don't show retry button — insufficient data won't produce a different result */
          ) : (
            <Button size="sm" onClick={handleReanalyze} disabled={!canAnalyze}>
              <Sparkles className="h-4 w-4 mr-2" />
              Analizar conversación
            </Button>
          )}
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
            {formatDate(conversation.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDuration(conversation.duration_seconds)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {conversation.words_count || 0} palabras
          </span>
          {conversation.category && <Badge variant="secondary">{conversation.category}</Badge>}
        </div>
      </div>

      {/* 3 Tabs: Análisis + Minuta + Transcripción */}
      <Tabs defaultValue="analisis">
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

        {/* Tab: Análisis */}
        <TabsContent value="analisis">
          {hasAnalysis && feedbackV4 ? (
            <div className="space-y-8 py-2">
              <ResumenHero feedback={feedbackV4} />
              <TuRadarCard feedback={feedbackV4} />
              <EmotionProfiles feedback={feedbackV4} speakerNameMap={speakerNameMap} />
              <KPIGrid feedback={feedbackV4} speakerNameMap={speakerNameMap} />
              <PatronCard feedback={feedbackV4} />
              <InsightsGrid feedback={feedbackV4} />
              <RealTimelineChart feedback={feedbackV4} speakerNameMap={speakerNameMap} />
              <HallazgosSection feedback={feedbackV4} />
              <PuertasDetalleSection feedback={feedbackV4} speakerNameMap={speakerNameMap} />
              <RecomendacionesSection feedback={feedbackV4} />

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
                {isWaitingForAnalysis ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Analizando con Maity...</h3>
                    <p className="text-muted-foreground">Las métricas se mostrarán automáticamente</p>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Sin análisis disponible</h3>
                    <p className="text-muted-foreground mb-4">Analiza la conversación para obtener métricas de comunicación</p>
                    {reanalyzeMutation.isPending ? (
                      <Button disabled>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analizando...
                      </Button>
                    ) : (
                      <Button onClick={handleReanalyze} disabled={!canAnalyze}>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Analizar conversación
                      </Button>
                    )}
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
              const radiografia = conversation.communication_feedback?.radiografia;
              const normalizedComponentes = Array.isArray(nm.efectividad?.componentes)
                ? nm.efectividad.componentes
                : [];

              return (
                <div className="space-y-6 py-2">
                  {/* Efectividad gauge */}
                  {nm.efectividad && <MinutaGauge efectividad={nm.efectividad} />}

                  {/* En 30 segundos */}
                  <SectionLabel text="En 30 segundos" />
                  <MinutaHeroSummary meta={nm.meta} temas={nm.temas} />

                  {/* KPI strip */}
                  <MinutaKPIStrip
                    meta={nm.meta}
                    decisiones={nm.decisiones}
                    accionesIncompletas={nm.acciones_incompletas}
                    acciones={nm.acciones?.lista || []}
                    graficas={nm.graficas}
                    userName={userName}
                    radiografia={radiografia}
                  />

                  {/* Seguimiento */}
                  <SectionLabel text="Seguimiento" />
                  <MinutaSeguimiento
                    seguimiento={nm.acciones?.seguimiento || null}
                    userName={userName}
                  />

                  {/* Decisiones */}
                  <SectionLabel text="Decisiones" />
                  <MinutaDecisions decisiones={nm.decisiones} />

                  {/* Desglose de Efectividad */}
                  <SectionLabel text="Desglose de Efectividad" />
                  <MinutaEfectividad componentes={normalizedComponentes} />

                  {/* Acciones */}
                  <SectionLabel text="Acciones" />
                  <MinutaActions acciones={nm.acciones?.lista || []} />

                  {/* Acciones Incompletas */}
                  <SectionLabel text="Acciones Incompletas" />
                  <MinutaIncompleteActions acciones={nm.acciones_incompletas} />
                </div>
              );
            }
          )() : (
            <Card>
              <CardContent className="p-12 text-center">
                {isWaitingForAnalysis ? (
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
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
