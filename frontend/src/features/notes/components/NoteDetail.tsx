'use client';

import { ArrowLeft, X, Calendar, Clock, MessageSquare, FileText, BookOpen, ListChecks, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OmiConversation, toggleActionItemCompleted } from '@/features/conversations';

interface NoteDetailProps {
  conversation: OmiConversation;
  onClose: () => void;
}

function extractText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    if ('tema' in obj) return `${obj.tema}${obj.razon ? ` — ${obj.razon}` : ''}`;
    const firstStr = Object.values(obj).find(v => typeof v === 'string');
    return typeof firstStr === 'string' ? firstStr : JSON.stringify(item);
  }
  return String(item);
}

export function NoteDetail({ conversation, onClose }: NoteDetailProps) {
  const queryClient = useQueryClient();
  const minutaData = conversation.meeting_minutes_data;
  const feedbackV1 = conversation.communication_feedback;

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

  const priorityColors: Record<string, string> = {
    high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-background">
      {/* Header actions */}
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

      {/* Title and metadata */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {conversation.emoji && (
            <span className="text-3xl">{conversation.emoji}</span>
          )}
          <h1 className="text-2xl font-bold text-foreground">{conversation.title}</h1>
        </div>
        {conversation.overview && (
          <p className="text-muted-foreground mb-4">{conversation.overview}</p>
        )}
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

      <div className="grid gap-6">
        {/* Meeting Minutes — V4 structured data (preferred) or V1 markdown fallback */}
        {minutaData ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-[#a78bfa]" />
                Minuta de Reunión
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {minutaData.temas && minutaData.temas.length > 0 && minutaData.temas.map((tema, i) => (
                <div key={i}>
                  <h5 className="text-sm font-medium text-foreground mb-1">{tema.titulo || tema.nombre || `Tema ${i + 1}`}</h5>
                  <p className="text-sm text-muted-foreground">{tema.resumen}</p>
                  {tema.puntos_clave && tema.puntos_clave.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {tema.puntos_clave.map((punto, j) => (
                        <li key={j} className="text-xs text-muted-foreground ml-4 list-disc">{punto}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {minutaData.decisiones && minutaData.decisiones.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Decisiones</h5>
                  <ul className="space-y-1">
                    {minutaData.decisiones.map((dec, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>{dec.descripcion || dec.titulo}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ) : feedbackV1?.meeting_minutes ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-[#a78bfa]" />
                Minuta de Reunión
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                {feedbackV1.meeting_minutes}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Overview — shown when no minuta exists */}
        {conversation.overview && !minutaData && !feedbackV1?.meeting_minutes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Resumen</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{conversation.overview}</p>
            </CardContent>
          </Card>
        )}

        {/* Temas — V4 structured (preferred) or V1 fallback */}
        {minutaData?.temas ? null /* Already shown in minuta above */ : feedbackV1?.temas ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5 text-[#a78bfa]" />
                Temas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedbackV1.temas.temas_tratados && feedbackV1.temas.temas_tratados.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Temas tratados</h5>
                  <div className="flex flex-wrap gap-2">
                    {feedbackV1.temas.temas_tratados.map((tema, i) => (
                      <Badge key={i} variant="secondary">{extractText(tema)}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {feedbackV1.temas.acciones_usuario && feedbackV1.temas.acciones_usuario.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">Compromisos del usuario</h5>
                  <ul className="space-y-1">
                    {feedbackV1.temas.acciones_usuario.map((acc, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{extractText(acc)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {feedbackV1.temas.temas_sin_cerrar && feedbackV1.temas.temas_sin_cerrar.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-amber-600 mb-2">Temas sin cerrar</h5>
                  <ul className="space-y-1">
                    {feedbackV1.temas.temas_sin_cerrar.map((tema, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{extractText(tema)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Acciones incompletas — V4 only */}
        {minutaData?.acciones_incompletas && minutaData.acciones_incompletas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-amber-600">
                <BookOpen className="h-5 w-5" />
                Temas sin cerrar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {minutaData.acciones_incompletas.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    {item.descripcion || item.compromiso || item.cita}
                    {item.que_falta && <span className="text-amber-600"> — {item.que_falta}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Action Items */}
        {conversation.action_items && conversation.action_items.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListChecks className="h-5 w-5 text-[#a78bfa]" />
                Tareas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {conversation.action_items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.completed ?? false}
                      onChange={() =>
                        toggleMutation.mutate({
                          index: i,
                          completed: !(item.completed ?? false),
                        })
                      }
                      disabled={toggleMutation.isPending}
                      className="mt-1 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-sm ${
                          item.completed
                            ? 'line-through text-muted-foreground'
                            : 'text-foreground'
                        }`}
                      >
                        {item.description}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        {item.priority && (
                          <Badge
                            variant="secondary"
                            className={`text-xs ${priorityColors[item.priority] || ''}`}
                          >
                            {item.priority}
                          </Badge>
                        )}
                        {item.assignee && (
                          <span className="text-xs text-muted-foreground">
                            {item.assignee}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
