'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, MessageSquare, Calendar, Sparkles, X, RefreshCw, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  OmiConversation,
  getOmiTranscriptSegments,
  getOmiConversation,
  reanalyzeConversation,
  toggleActionItemCompleted,
} from '../services/conversations.service';
import {
  ResumenHero,
  KPIGrid,
  ScoreBars,
  MuletillasSection,
  PreguntasSection,
  TemasSection,
  PatronSection,
  InsightsSection,
  FortalezasAreasSection,
  TranscriptSection,
} from './analysis';

interface ConversationDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
  onConversationUpdate?: (updated: OmiConversation) => void;
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

export function ConversationDetail({ conversation: initialConversation, onClose, onConversationUpdate, isAnalyzing }: ConversationDetailProps) {
  const [conversation, setConversation] = useState(initialConversation);
  const [isWaitingForAnalysis, setIsWaitingForAnalysis] = useState(isAnalyzing ?? false);
  const queryClient = useQueryClient();

  // Poll for analysis completion when isAnalyzing is true
  useEffect(() => {
    if (!isWaitingForAnalysis) return;
    const interval = setInterval(async () => {
      try {
        const updated = await getOmiConversation(conversation.id);
        if (updated?.communication_feedback) {
          setConversation(updated);
          onConversationUpdate?.(updated);
          setIsWaitingForAnalysis(false);
          queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
          toast.success('Analisis completado');
        }
      } catch (err) {
        console.warn('Error polling for analysis:', err);
      }
    }, 5000);
    const timeout = setTimeout(() => {
      setIsWaitingForAnalysis(false);
      toast.info('El analisis esta tardando. Puedes reanalizar manualmente.');
    }, 120000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [isWaitingForAnalysis, conversation.id, onConversationUpdate, queryClient]);

  // Listen for finalize-completed event from useRecordingStop fire-and-forget
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId === conversation.id) {
        try {
          const updated = await getOmiConversation(conversation.id);
          if (updated) {
            setConversation(updated);
            onConversationUpdate?.(updated);
            setIsWaitingForAnalysis(false);
            queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
          }
        } catch (err) {
          console.warn('Error refetching after finalize-completed:', err);
        }
      }
    };
    window.addEventListener('finalize-completed', handler);
    return () => window.removeEventListener('finalize-completed', handler);
  }, [conversation.id, onConversationUpdate, queryClient]);

  const { data: segments, isLoading: loadingSegments } = useQuery({
    queryKey: ['omi-segments', conversation.id],
    queryFn: () => getOmiTranscriptSegments(conversation.id),
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (transcriptText: string) =>
      reanalyzeConversation(conversation.id, transcriptText, conversation.language || 'es'),
    onSuccess: (updated) => {
      setConversation(updated);
      onConversationUpdate?.(updated);
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
      toast.success('Analisis completado');
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

  const feedback = conversation.communication_feedback;
  const hasAnalysis = !!feedback;
  const canAnalyze = !reanalyzeMutation.isPending && !loadingSegments &&
    ((segments && segments.length > 0) || !!conversation.transcript_text);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-background">
      {/* Close button */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div className="flex items-center gap-2">
          {reanalyzeMutation.isPending ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analizando...
            </Button>
          ) : hasAnalysis ? (
            <Button variant="outline" size="sm" onClick={handleReanalyze} disabled={!canAnalyze}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reanalizar
            </Button>
          ) : (
            <Button size="sm" onClick={handleReanalyze} disabled={!canAnalyze}>
              <Sparkles className="h-4 w-4 mr-2" />
              Analizar conversacion
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

      {/* 2 Tabs: Análisis + Transcripción */}
      <Tabs defaultValue="analisis">
        <TabsList className="w-full">
          <TabsTrigger value="analisis" className="flex-1 gap-2">
            <Sparkles className="h-4 w-4" />
            Analisis
          </TabsTrigger>
          <TabsTrigger value="transcripcion" className="flex-1 gap-2">
            <MessageSquare className="h-4 w-4" />
            Transcripcion
          </TabsTrigger>
        </TabsList>

        {/* Tab: Análisis */}
        <TabsContent value="analisis">
          {hasAnalysis && feedback ? (
            <div className="space-y-8 py-2">
              {/* 1. Resumen Hero — Gauge semicircular */}
              <ResumenHero feedback={feedback} />

              {/* 2. Radiografía Rápida — 8 KPIs */}
              <KPIGrid feedback={feedback} />

              {/* 3. Competencias de Comunicación — 6 score bars */}
              <ScoreBars feedback={feedback} />

              {/* 4. Muletillas — barras horizontales */}
              <MuletillasSection feedback={feedback} />

              {/* 5. Preguntas — 2 columnas */}
              <PreguntasSection feedback={feedback} />

              {/* 6-8. Temas + Compromisos + Pendientes */}
              <TemasSection feedback={feedback} />

              {/* 9. Fortalezas + Áreas de mejora */}
              <FortalezasAreasSection feedback={feedback} />

              {/* 10. Patrón de comunicación (opcional) */}
              <PatronSection feedback={feedback} />

              {/* 11. Insights (opcional) */}
              <InsightsSection feedback={feedback} />

              {/* Meeting Minutes (if present) */}
              {feedback.meeting_minutes && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">Minuta de Reunion</h3>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap rounded-lg border border-border bg-card p-4">
                    {feedback.meeting_minutes}
                  </div>
                </div>
              )}

              {/* Action Items (if present) */}
              {conversation.action_items && conversation.action_items.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">Tareas</h3>
                  <ul className="space-y-3">
                    {conversation.action_items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                        <input
                          type="checkbox"
                          checked={item.completed ?? false}
                          onChange={() =>
                            toggleMutation.mutate({ index: i, completed: !(item.completed ?? false) })
                          }
                          disabled={toggleMutation.isPending}
                          className="mt-1 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
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
          ) : (
            /* No analysis yet */
            <Card>
              <CardContent className="p-12 text-center">
                {isWaitingForAnalysis ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Analizando tu conversacion...</h3>
                    <p className="text-muted-foreground">Las metricas de comunicacion se mostraran automaticamente</p>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2 text-foreground">Sin analisis disponible</h3>
                    <p className="text-muted-foreground mb-4">Analiza la conversacion para obtener metricas de comunicacion</p>
                    {reanalyzeMutation.isPending ? (
                      <Button disabled>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analizando...
                      </Button>
                    ) : (
                      <Button onClick={handleReanalyze} disabled={!canAnalyze}>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Analizar conversacion
                      </Button>
                    )}
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
                loading={loadingSegments}
                fallbackText={conversation.transcript_text}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
