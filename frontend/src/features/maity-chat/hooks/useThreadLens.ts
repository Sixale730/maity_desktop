import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as svc from '../services/maityChatService';
import type { ChatThread, Lens } from '../types';

const threadsKey = (userId: string | undefined) => ['maity-chat', 'threads', userId] as const;

interface UpdateLensVars {
  threadId: string;
  lens: Lens;
}

/**
 * Persist the listening lens on a thread. Optimistic so the composer UI
 * (border-top color, send button gradient) updates instantly. Rolls back
 * on error.
 */
export function useThreadLens(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<void, unknown, UpdateLensVars, { previous?: ChatThread[] }>({
    mutationFn: ({ threadId, lens }) => svc.updateThreadLens(threadId, lens),
    onMutate: async ({ threadId, lens }) => {
      await qc.cancelQueries({ queryKey: threadsKey(userId) });
      const previous = qc.getQueryData<ChatThread[]>(threadsKey(userId));
      qc.setQueryData<ChatThread[]>(threadsKey(userId), (prev) =>
        prev?.map((t) => (t.id === threadId ? { ...t, lens } : t)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(threadsKey(userId), ctx.previous);
      toast.error('No se pudo cambiar el lente', { description: String(err) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: threadsKey(userId) });
    },
  });
}
