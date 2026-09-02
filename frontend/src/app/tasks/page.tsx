'use client';

import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getOmiConversations, LIST_DEFAULT_LIMIT } from '@/features/conversations';
import { TasksList } from '@/features/tasks';

export default function TasksPage() {
  const { maityUser } = useAuth();

  const { data: conversations, isLoading } = useQuery({
    // La key lleva el `limit` explicito para que sea IDENTICA a la del estado
    // inicial de ConversationsList (y a la de /notes): asi las tres vistas
    // comparten una sola entrada de cache en vez de fetchear 200 filas cada
    // una por su cuenta. TanStack hashea la key completa, asi que omitir el
    // tercer elemento crearia una cache paralela con el mismo contenido.
    // El render de Tasks NO cambia: `action_items` sigue completo en la
    // proyeccion ligera (141 B de media, no compensa separarlo).
    queryKey: ['omi-conversations', maityUser?.id, { limit: LIST_DEFAULT_LIMIT }],
    queryFn: () => getOmiConversations(maityUser?.id),
    enabled: !!maityUser?.id,
  });

  return (
    <div className="h-full flex flex-col bg-muted">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-orange-500/10">
            <ListChecks className="h-6 w-6 text-orange-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tareas</h1>
            <p className="text-muted-foreground">Todas las tareas de tus reuniones</p>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <p className="text-muted-foreground text-sm">Cargando tareas...</p>
        )}

        {/* Task list */}
        {!isLoading && conversations && (
          <TasksList conversations={conversations} />
        )}
      </div>
    </div>
  );
}
