import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as svc from '../services/maityChatService'
import type { ChatThread } from '../types'

const threadsKey = (userId: string | undefined) => ['maity-chat', 'threads', userId] as const

export function useThreads(userId: string | undefined) {
  return useQuery({
    queryKey: threadsKey(userId),
    queryFn: () => svc.listThreads(userId!),
    enabled: !!userId,
    staleTime: 1000 * 30,
  })
}

export function useCreateThread(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (!userId) throw new Error('Sesión no disponible')
      return svc.createThread(userId)
    },
    onSuccess: (thread) => {
      qc.setQueryData<ChatThread[]>(threadsKey(userId), (prev) => [thread, ...(prev ?? [])])
    },
    onError: (err: unknown) => {
      toast.error('No se pudo crear el chat', { description: String(err) })
    },
  })
}

export function useRenameThread(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ threadId, title }: { threadId: string; title: string }) =>
      svc.renameThread(threadId, title),
    onSuccess: (_, { threadId, title }) => {
      qc.setQueryData<ChatThread[]>(threadsKey(userId), (prev) =>
        prev?.map((t) => (t.id === threadId ? { ...t, title } : t)),
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo renombrar', { description: String(err) })
    },
  })
}

export function useDeleteThread(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => svc.deleteThread(threadId),
    onSuccess: (_, threadId) => {
      qc.setQueryData<ChatThread[]>(threadsKey(userId), (prev) =>
        prev?.filter((t) => t.id !== threadId),
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo eliminar', { description: String(err) })
    },
  })
}
