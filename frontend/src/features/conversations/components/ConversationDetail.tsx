'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, MessageSquare, CheckCircle2, Calendar, Sparkles, User, Bot, Lightbulb, MessageCircle, LayoutList, Shield, Target, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { OmiConversation, getOmiTranscriptSegments } from '../services/conversations.service';

interface ConversationDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
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

export function ConversationDetail({ conversation, onClose }: ConversationDetailProps) {
  const { data: segments, isLoading: loadingSegments } = useQuery({
    queryKey: ['omi-segments', conversation.id],
    queryFn: () => getOmiTranscriptSegments(conversation.id),
  });

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
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
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
        {/* Communication Feedback */}
        {feedback && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                Análisis de Comunicación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Overall Score */}
              {feedback.overall_score !== undefined && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Puntuación General</span>
                    <span className="font-medium text-foreground">{feedback.overall_score}/10</span>
                  </div>
                  <Progress value={feedback.overall_score * 10} className="h-2" />
                </div>
              )}

              {/* Individual Scores */}
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
              </div>

              {/* Feedback Text (usa summary como fallback) */}
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
                    <h4 className="text-sm font-medium mb-2 text-amber-600">Áreas de Mejora</h4>
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
                      <InsightCard
                        icon={MessageCircle}
                        title="Claridad"
                        content={feedback.observations.clarity}
                      />
                    )}
                    {feedback.observations.structure && (
                      <InsightCard
                        icon={LayoutList}
                        title="Estructura"
                        content={feedback.observations.structure}
                      />
                    )}
                    {feedback.observations.objections && (
                      <InsightCard
                        icon={Shield}
                        title="Objeciones"
                        content={feedback.observations.objections}
                      />
                    )}
                    {feedback.observations.calls_to_action && (
                      <InsightCard
                        icon={Target}
                        title="Llamadas a la Acción"
                        content={feedback.observations.calls_to_action}
                      />
                    )}
                  </div>
                </div>
              )}
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
          <CardTitle className="text-lg">Transcripción</CardTitle>
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
                        {segment.speaker || (segment.is_user ? 'Tú' : 'Otro')}
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
              Sin transcripción disponible
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
