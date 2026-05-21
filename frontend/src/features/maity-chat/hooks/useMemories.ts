import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as svc from '../services/maityChatService'
import type { ChatMemory, ChatSettings } from '../types'

const memoriesKey = (userId: string | undefined) =>
  ['maity-chat', 'memories', userId] as const

const settingsKey = (userId: string | undefined) =>
  ['maity-chat', 'settings', userId] as const

export function useMemories(userId: string | undefined) {
  return useQuery({
    queryKey: memoriesKey(userId),
    queryFn: () => svc.listMemories(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60,
  })
}

export function useChatSettings(userId: string | undefined) {
  return useQuery({
    queryKey: settingsKey(userId),
    queryFn: () => svc.getSettings(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60,
  })
}

export function useApproveMemory(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memoryId: string) => svc.approveMemory(memoryId),
    onSuccess: (_, memoryId) => {
      qc.setQueryData<ChatMemory[]>(memoriesKey(userId), (prev) =>
        prev?.map((m) => (m.id === memoryId ? { ...m, status: 'approved' } : m)),
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo aprobar', { description: String(err) })
    },
  })
}

export function useRejectMemory(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memoryId: string) => svc.rejectMemory(memoryId),
    onSuccess: (_, memoryId) => {
      qc.setQueryData<ChatMemory[]>(memoriesKey(userId), (prev) =>
        prev?.filter((m) => m.id !== memoryId),
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo descartar', { description: String(err) })
    },
  })
}

export function useUpdateMemoryContent(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memoryId, content }: { memoryId: string; content: string }) =>
      svc.updateMemoryContent(memoryId, content),
    onSuccess: (_, { memoryId, content }) => {
      qc.setQueryData<ChatMemory[]>(memoriesKey(userId), (prev) =>
        prev?.map((m) => (m.id === memoryId ? { ...m, content } : m)),
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo editar', { description: String(err) })
    },
  })
}

export function useAddManualMemory(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => {
      if (!userId) throw new Error('Sesión no disponible')
      return svc.addManualMemory(userId, content)
    },
    onSuccess: (memory) => {
      qc.setQueryData<ChatMemory[]>(memoriesKey(userId), (prev) => [memory, ...(prev ?? [])])
    },
    onError: (err: unknown) => {
      toast.error('No se pudo agregar', { description: String(err) })
    },
  })
}

export function useSetMemoryExtractionPaused(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paused: boolean) => {
      if (!userId) throw new Error('Sesión no disponible')
      return svc.setMemoryExtractionPaused(userId, paused)
    },
    onSuccess: (_, paused) => {
      qc.setQueryData<ChatSettings | null>(settingsKey(userId), (prev) =>
        prev
          ? { ...prev, memory_extraction_paused: paused }
          : {
              user_id: userId!,
              memory_extraction_paused: paused,
              updated_at: new Date().toISOString(),
            },
      )
    },
    onError: (err: unknown) => {
      toast.error('No se pudo actualizar', { description: String(err) })
    },
  })
}
