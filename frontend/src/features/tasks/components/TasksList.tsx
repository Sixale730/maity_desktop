'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OmiConversation, toggleActionItemCompleted } from '@/features/conversations';

interface TasksListProps {
  conversations: OmiConversation[];
}

function priorityBadge(priority: string) {
  switch (priority) {
    case 'high':
      return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{priority}</Badge>;
    case 'medium':
      return <Badge className="text-[10px] px-1.5 py-0 bg-yellow-500 text-white border-transparent hover:bg-yellow-500/80">{priority}</Badge>;
    case 'low':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{priority}</Badge>;
    default:
      return null;
  }
}

export function TasksList({ conversations }: TasksListProps) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: ({ conversationId, itemIndex, completed }: {
      conversationId: string;
      itemIndex: number;
      completed: boolean;
    }) => toggleActionItemCompleted(conversationId, itemIndex, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
    },
    onError: () => {
      toast.error('Error al actualizar la tarea');
    },
  });

  const conversationsWithTasks = conversations.filter(
    (c) => c.action_items && c.action_items.length > 0
  );

  if (conversationsWithTasks.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <ListChecks className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2 text-foreground">No hay tareas</h3>
          <p className="text-muted-foreground">Las tareas extraidas de tus reuniones apareceran aqui</p>
        </CardContent>
      </Card>
    );
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
    });
  };

  return (
    <div className="space-y-4">
      {conversationsWithTasks.map((conversation) => (
        <div key={conversation.id}>
          {/* Section header */}
          <div className="flex items-center gap-2 mb-2">
            {conversation.emoji && (
              <span className="text-base">{conversation.emoji}</span>
            )}
            <h2 className="text-sm font-semibold text-foreground truncate">
              {conversation.title}
            </h2>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatDate(conversation.created_at)}
            </span>
          </div>

          {/* Action items */}
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {conversation.action_items!.map((item, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-all duration-300 ${item.completed ? 'opacity-50' : 'opacity-100'}`}
                >
                  <input
                    type="checkbox"
                    checked={!!item.completed}
                    onChange={() =>
                      toggleMutation.mutate({
                        conversationId: conversation.id,
                        itemIndex: idx,
                        completed: !item.completed,
                      })
                    }
                    className="mt-0.5 h-5 w-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500 accent-orange-500 flex-shrink-0 cursor-pointer hover:scale-110 transition-transform"
                  />
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-sm transition-all duration-300 ${
                        item.completed
                          ? 'line-through text-muted-foreground'
                          : 'text-foreground'
                      }`}
                    >
                      {item.description}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      {item.priority && priorityBadge(item.priority)}
                      {item.assignee && (
                        <span className="text-xs text-muted-foreground">
                          {item.assignee}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
