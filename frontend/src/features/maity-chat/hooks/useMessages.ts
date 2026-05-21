import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as svc from '../services/maityChatService'
import type { ChatMemory, ChatMessage, ChatThread } from '../types'

const messagesKey = (threadId: string | undefined) =>
  ['maity-chat', 'messages', threadId] as const

const threadsKey = (userId: string | undefined) => ['maity-chat', 'threads', userId] as const

export function useMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: messagesKey(threadId),
    queryFn: () => svc.listMessages(threadId!),
    enabled: !!threadId,
    staleTime: 1000 * 30,
  })
}

export function useSendMessage(userId: string | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      thread: ChatThread
      content: string
      history: ChatMessage[]
      approvedMemories: ChatMemory[]
    }) => {
      if (!userId) throw new Error('Sesión no disponible')
      return svc.sendMessage({ ...params, userId })
    },
    onSuccess: (result, vars) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(vars.thread.id), (prev) => [
        ...(prev ?? []),
        result.userMessage,
        result.assistantMessage,
      ])

      if (result.threadTitle) {
        qc.setQueryData<ChatThread[]>(threadsKey(userId), (prev) =>
          prev?.map((t) => (t.id === vars.thread.id ? { ...t, title: result.threadTitle! } : t)),
        )
      }

      qc.invalidateQueries({ queryKey: threadsKey(userId) })

      if (result.proposedMemories.length > 0) {
        qc.invalidateQueries({ queryKey: ['maity-chat', 'memories', userId] })
      }
    },
    onError: (err: unknown) => {
      toast.error('No se pudo enviar el mensaje', { description: String(err) })
    },
  })
}
