'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { getOmiConversations } from '@/features/conversations';
import { TasksList } from '@/features/tasks';

export default function TasksPage() {
  const { isAdmin } = useUserRole();
  const { maityUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, router]);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['omi-conversations', maityUser?.id],
    queryFn: () => getOmiConversations(maityUser?.id),
    enabled: !!maityUser?.id,
  });

  if (!isAdmin) return null;

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
