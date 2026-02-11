'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText, Clock, MessageSquare, ChevronRight, ListChecks } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { getOmiConversations, OmiConversation } from '@/features/conversations';
import { NoteDetail } from '@/features/notes';

export default function NotesPage() {
  const { isRegularUser } = useUserRole();
  const router = useRouter();
  const { maityUser } = useAuth();
  const [selectedConversation, setSelectedConversation] = useState<OmiConversation | null>(null);

  useEffect(() => {
    if (isRegularUser) {
      router.replace('/');
    }
  }, [isRegularUser, router]);

  const { data: conversations, isLoading, error } = useQuery({
    queryKey: ['omi-conversations', maityUser?.id],
    queryFn: () => getOmiConversations(maityUser?.id),
    enabled: !!maityUser?.id,
  });

  if (isRegularUser) return null;

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

  if (selectedConversation) {
    return (
      <div className="h-full flex flex-col bg-background">
        <NoteDetail
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full bg-muted">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
            <FileText className="h-6 w-6 text-[#a78bfa]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Notas</h1>
            <p className="text-muted-foreground">Minutas y tareas de tus reuniones</p>
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
              Error al cargar las notas
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!isLoading && !error && conversations?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2 text-foreground">No hay notas</h3>
              <p className="text-muted-foreground">Las minutas y tareas de tus reuniones apareceran aqui</p>
            </CardContent>
          </Card>
        )}

        {/* Notes list */}
        {!isLoading && conversations && conversations.length > 0 && (
          <div className="space-y-3">
            {conversations.map((conversation) => {
              const feedback = conversation.communication_feedback;
              const hasMinuta = !!feedback?.meeting_minutes;
              const actionItems = conversation.action_items;
              const hasActionItems = actionItems && actionItems.length > 0;

              return (
                <Card
                  key={conversation.id}
                  className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
                  onClick={() => setSelectedConversation(conversation)}
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
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                          <span>{formatDate(conversation.created_at)}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(conversation.duration_seconds)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {conversation.words_count || 0} palabras
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasMinuta && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <FileText className="h-3 w-3" />
                              Minuta
                            </Badge>
                          )}
                          {hasActionItems && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <ListChecks className="h-3 w-3" />
                              Tareas ({actionItems.length})
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
