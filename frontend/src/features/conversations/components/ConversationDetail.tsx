'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, MessageSquare, CheckCircle2, Calendar, Sparkles, User, Bot, Lightbulb, MessageCircle, LayoutList, Shield, Target, X, FileText, RefreshCw, Loader2, BarChart3, HelpCircle, Hash, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { OmiConversation, OmiTranscriptSegment, getOmiTranscriptSegments, reanalyzeConversation } from '../services/conversations.service';

interface ConversationDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
  onConversationUpdate?: (updated: OmiConversation) => void;
}

function buildTranscriptText(segments: OmiTranscriptSegment[]): string {
  return segments
    .map((s) => {
      const speaker = s.is_user ? 'Usuario' : 'Interlocutor';
      return `${speaker}: ${s.text}`;
    })
    .join('\n');
}

// Componente para mostrar una tarjeta de insight
function InsightCard({ icon: Icon, title, content }: { icon: React.ComponentType<{ className?: string }>; title: string; content: string }) {
  return (
    <div className="p-3 bg-secondary rounded-lg border border-border">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <h5 className="text-sm font-medium text-foreground">{title}</h5>
      </div>
      <p className="text-sm text-muted-foreground">{content}</p>
    </div>
  );
}

export function ConversationDetail({ conversation: initialConversation, onClose, onConversationUpdate }: ConversationDetailProps) {
  const [conversation, setConversation] = useState(initialConversation);
  const queryClient = useQueryClient();

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
    <div className="flex-1 overflow-y-auto p-4 bg-background">
      {/* Close button */}
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="-ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div className="flex items-center gap-2">
          {/* Analyze / Reanalyze button */}
          {reanalyzeMutation.isPending ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analizando...
            </Button>
          ) : hasAnalysis ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReanalyze}
              disabled={!canAnalyze}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reanalizar
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleReanalyze}
              disabled={!canAnalyze}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Analizar conversacion
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {conversation.emoji && (
            <span className="text-3xl">{conversation.emoji}</span>
          )}
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
          {conversation.category && (
            <Badge variant="secondary">{conversation.category}</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Communication Feedback - Scores */}
        {feedback && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                Analisis de Comunicacion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Overall Score */}
              {feedback.overall_score !== undefined && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Puntuacion General</span>
                    <span className="font-medium text-foreground">{feedback.overall_score}/10</span>
                  </div>
                  <Progress value={feedback.overall_score * 10} className="h-2" />
                </div>
              )}

              {/* Individual Scores - 6 total */}
              <div className="grid gap-3 sm:grid-cols-3">
                {feedback.clarity !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Claridad</div>
                    <div className="text-xl font-bold text-foreground">{feedback.clarity}/10</div>
                  </div>
                )}
                {feedback.engagement !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Engagement</div>
                    <div className="text-xl font-bold text-foreground">{feedback.engagement}/10</div>
                  </div>
                )}
                {feedback.structure !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Estructura</div>
                    <div className="text-xl font-bold text-foreground">{feedback.structure}/10</div>
                  </div>
                )}
                {feedback.empatia !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Empatia</div>
                    <div className="text-xl font-bold text-foreground">{feedback.empatia}/10</div>
                  </div>
                )}
                {feedback.vocabulario !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Vocabulario</div>
                    <div className="text-xl font-bold text-foreground">{feedback.vocabulario}/10</div>
                  </div>
                )}
                {feedback.objetivo !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Objetivo</div>
                    <div className="text-xl font-bold text-foreground">{feedback.objetivo}/10</div>
                  </div>
                )}
              </div>

              {/* Feedback Text */}
              {(feedback.feedback || feedback.summary) && (
                <p className="text-sm text-muted-foreground">{feedback.feedback || feedback.summary}</p>
              )}

              {/* Strengths & Areas to Improve */}
              <div className="grid gap-4 sm:grid-cols-2">
                {feedback.strengths && feedback.strengths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 text-green-600">Fortalezas</h4>
                    <ul className="space-y-1">
                      {feedback.strengths.map((s, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span className="text-muted-foreground">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {feedback.areas_to_improve && feedback.areas_to_improve.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 text-amber-600">Areas de Mejora</h4>
                    <ul className="space-y-1">
                      {feedback.areas_to_improve.map((a, i) => (
                        <li key={i} className="text-sm text-muted-foreground">• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Insights/Observations */}
              {feedback.observations && (
                <div className="space-y-3 pt-4 border-t border-border">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-foreground">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    Insights
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {feedback.observations.clarity && (
                      <InsightCard icon={MessageCircle} title="Claridad" content={feedback.observations.clarity} />
                    )}
                    {feedback.observations.structure && (
                      <InsightCard icon={LayoutList} title="Estructura" content={feedback.observations.structure} />
                    )}
                    {feedback.observations.objections && (
                      <InsightCard icon={Shield} title="Objeciones" content={feedback.observations.objections} />
                    )}
                    {feedback.observations.calls_to_action && (
                      <InsightCard icon={Target} title="Llamadas a la Accion" content={feedback.observations.calls_to_action} />
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Radiografia del Habla */}
        {feedback?.radiografia && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-primary" />
                Radiografia del Habla
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.radiografia.ratio_habla !== undefined && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Ratio de habla (usuario)</span>
                    <span className="font-medium text-foreground">{Math.round(feedback.radiografia.ratio_habla * 100)}%</span>
                  </div>
                  <Progress value={feedback.radiografia.ratio_habla * 100} className="h-2" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {feedback.radiografia.palabras_usuario !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Palabras usuario</div>
                    <div className="text-lg font-bold text-foreground">{feedback.radiografia.palabras_usuario}</div>
                  </div>
                )}
                {feedback.radiografia.palabras_otros !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Palabras otros</div>
                    <div className="text-lg font-bold text-foreground">{feedback.radiografia.palabras_otros}</div>
                  </div>
                )}
              </div>
              {feedback.radiografia.muletillas_detectadas && Object.keys(feedback.radiografia.muletillas_detectadas).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Muletillas detectadas</h5>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(feedback.radiografia.muletillas_detectadas).map(([word, count]) => (
                      <Badge key={word} variant="outline">
                        {word}: {count}
                      </Badge>
                    ))}
                  </div>
                  {feedback.radiografia.muletillas_frecuencia && (
                    <p className="text-xs text-muted-foreground mt-2">{feedback.radiografia.muletillas_frecuencia}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Contadores */}
        {feedback?.counters && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Hash className="h-5 w-5 text-primary" />
                Contadores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.counters.filler_words && Object.keys(feedback.counters.filler_words).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Palabras de relleno</h5>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(feedback.counters.filler_words).map(([word, count]) => (
                      <Badge key={word} variant="secondary">
                        {word}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {feedback.counters.objection_words && Object.keys(feedback.counters.objection_words).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Palabras de objecion</h5>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(feedback.counters.objection_words).map(([word, count]) => (
                      <Badge key={word} variant="outline">
                        {word}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {feedback.counters.objections_made && feedback.counters.objections_made.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Objeciones hechas</h5>
                  <ul className="space-y-1">
                    {feedback.counters.objections_made.map((obj, i) => (
                      <li key={i} className="text-sm text-muted-foreground">• {obj}</li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.counters.objections_received && feedback.counters.objections_received.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Objeciones recibidas</h5>
                  <ul className="space-y-1">
                    {feedback.counters.objections_received.map((obj, i) => (
                      <li key={i} className="text-sm text-muted-foreground">• {obj}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Preguntas */}
        {feedback?.preguntas && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HelpCircle className="h-5 w-5 text-primary" />
                Preguntas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {feedback.preguntas.total_usuario !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg text-center">
                    <div className="text-xs text-muted-foreground mb-1">Usuario</div>
                    <div className="text-2xl font-bold text-foreground">{feedback.preguntas.total_usuario}</div>
                  </div>
                )}
                {feedback.preguntas.total_otros !== undefined && (
                  <div className="p-3 bg-secondary rounded-lg text-center">
                    <div className="text-xs text-muted-foreground mb-1">Otros</div>
                    <div className="text-2xl font-bold text-foreground">{feedback.preguntas.total_otros}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Temas */}
        {feedback?.temas && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5 text-primary" />
                Temas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.temas.temas_tratados && feedback.temas.temas_tratados.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Temas tratados</h5>
                  <div className="flex flex-wrap gap-2">
                    {feedback.temas.temas_tratados.map((tema, i) => (
                      <Badge key={i} variant="secondary">{tema}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {feedback.temas.acciones_usuario && feedback.temas.acciones_usuario.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Compromisos del usuario</h5>
                  <ul className="space-y-1">
                    {feedback.temas.acciones_usuario.map((acc, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{acc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.temas.temas_sin_cerrar && feedback.temas.temas_sin_cerrar.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-amber-600 mb-2">Temas sin cerrar</h5>
                  <ul className="space-y-1">
                    {feedback.temas.temas_sin_cerrar.map((tema, i) => (
                      <li key={i} className="text-sm text-muted-foreground">• {tema}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Meeting Minutes */}
        {feedback?.meeting_minutes && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" />
                Minuta de Reunion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                {feedback.meeting_minutes}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Items */}
        {conversation.action_items && conversation.action_items.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Acciones Pendientes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {conversation.action_items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${item.completed ? 'text-green-500' : 'text-muted-foreground'}`} />
                    <span className={item.completed ? 'line-through text-muted-foreground' : 'text-muted-foreground'}>
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Events */}
        {conversation.events && conversation.events.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Eventos</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {conversation.events.map((event, i) => (
                  <li key={i} className="border-l-2 border-primary/30 pl-3">
                    <div className="font-medium text-sm text-foreground">{event.title}</div>
                    {event.description && (
                      <div className="text-xs text-muted-foreground">{event.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Transcript */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Transcripcion</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingSegments ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-20 mb-1" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : segments && segments.length > 0 ? (
            <div className="space-y-4">
              {segments.map((segment) => (
                <div key={segment.id} className="flex gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${segment.is_user ? 'bg-primary/10' : 'bg-secondary'}`}>
                    {segment.is_user ? (
                      <User className="h-4 w-4 text-primary" />
                    ) : (
                      <Bot className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-foreground">
                        {segment.speaker || (segment.is_user ? 'Tu' : 'Otro')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Math.floor(segment.start_time / 60)}:{Math.floor(segment.start_time % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{segment.text}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : conversation.transcript_text ? (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{conversation.transcript_text}</p>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin transcripcion disponible
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
