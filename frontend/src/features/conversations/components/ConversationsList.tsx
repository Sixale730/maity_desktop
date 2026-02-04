'use client';

import { useQuery } from '@tanstack/react-query';
import { AudioLines, Clock, MessageSquare, ChevronRight, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { getOmiConversations, OmiConversation } from '../services/conversations.service';

interface ConversationsListProps {
  onSelect: (conversation: OmiConversation) => void;
  selectedId?: string | null;
}

export function ConversationsList({ onSelect, selectedId }: ConversationsListProps) {
  const { maityUser } = useAuth();

  const { data: conversations, isLoading, error } = useQuery({
    queryKey: ['omi-conversations', maityUser?.id],
    queryFn: () => getOmiConversations(maityUser?.id),
    enabled: !!maityUser?.id,
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
    <div className="flex-1 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
          <AudioLines className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conversaciones</h1>
          <p className="text-muted-foreground">Tu historial de conversaciones con OMI</p>
        </div>
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
            <p className="text-muted-foreground">Tus conversaciones con OMI aparecerán aquí</p>
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
                        {formatDuration(conversation.duration_seconds)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {conversation.words_count || 0} palabras
                      </span>
                      <span>{formatDate(conversation.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {conversation.category && (
                      <Badge variant="secondary" className="text-xs">
                        {conversation.category}
                      </Badge>
                    )}
                    {conversation.communication_feedback && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Sparkles className="h-3 w-3" />
                        Análisis
                      </Badge>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
