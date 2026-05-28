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

interface SendVars {
  thread: ChatThread
  content: string
  history: ChatMessage[]
  approvedMemories: ChatMemory[]
}

interface SendContext {
  previous: ChatMessage[]
  tempUserId: string
  tempAssistantId: string
}

export function useSendMessage(userId: string | undefined) {
  const qc = useQueryClient()

  return useMutation<Awaited<ReturnType<typeof svc.sendMessage>>, unknown, SendVars, SendContext>({
    // Inserts optimistas al inicio: el turno del usuario Y un placeholder
    // vacío del assistant. A medida que el stream SSE entrega deltas, los
    // apendamos al placeholder para que la UI renderice progresivamente. Sin
    // el placeholder, el primer token no tendría dónde aterrizar.
    //
    // Los ids temporales se reemplazan atómicamente por las filas canónicas
    // (devueltas por fetchLatestPair) cuando el stream completa.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: messagesKey(vars.thread.id) })
      const previous = qc.getQueryData<ChatMessage[]>(messagesKey(vars.thread.id)) ?? []
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const tempUserId = `temp-user-${seed}`
      const tempAssistantId = `temp-assistant-${seed}`
      const now = new Date().toISOString()
      const optimisticUser: ChatMessage = {
        id: tempUserId,
        thread_id: vars.thread.id,
        user_id: userId ?? '',
        role: 'user',
        content: vars.content,
        client_idempotency_key: null,
        created_at: now,
      }
      const optimisticAssistant: ChatMessage = {
        id: tempAssistantId,
        thread_id: vars.thread.id,
        user_id: userId ?? '',
        role: 'assistant',
        content: '',
        client_idempotency_key: null,
        created_at: now,
      }
      qc.setQueryData<ChatMessage[]>(messagesKey(vars.thread.id), [
        ...previous,
        optimisticUser,
        optimisticAssistant,
      ])
      return { previous, tempUserId, tempAssistantId }
    },
    mutationFn: async (params) => {
      if (!userId) throw new Error('Sesión no disponible')
      // mutationFn no recibe el context de onMutate; recuperamos el id del
      // assistant temporal escaneando el cache por la fila assistant vacía
      // que onMutate acaba de insertar. Recorremos desde el final para
      // encontrar el placeholder más reciente si dos envíos compiten.
      const cached = qc.getQueryData<ChatMessage[]>(messagesKey(params.thread.id)) ?? []
      const tempAssistant = [...cached]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' &&
            m.content === '' &&
            m.id.startsWith('temp-assistant-'),
        )
      const tempAssistantId = tempAssistant?.id

      return svc.sendMessage({
        ...params,
        userId,
        onDelta: tempAssistantId
          ? (delta) => {
              qc.setQueryData<ChatMessage[]>(messagesKey(params.thread.id), (prev) =>
                prev?.map((m) =>
                  m.id === tempAssistantId ? { ...m, content: m.content + delta } : m,
                ),
              )
            }
          : undefined,
      })
    },
    onSuccess: (result, vars, context) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(vars.thread.id), (prev) => {
        const withoutTemps = (prev ?? []).filter(
          (m) => m.id !== context?.tempUserId && m.id !== context?.tempAssistantId,
        )
        return [...withoutTemps, result.userMessage, result.assistantMessage]
      })

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
    onError: (err, vars) => {
      // No revertimos al snapshot previo — eso borraría la burbuja del usuario
      // aunque su turno ya se persistió server-side. Refetch en su lugar:
      // muestra el mensaje persistido del usuario y descarta los placeholders.
      qc.invalidateQueries({ queryKey: messagesKey(vars.thread.id) })
      toast.error('No se pudo enviar el mensaje', { description: String(err) })
    },
  })
}
