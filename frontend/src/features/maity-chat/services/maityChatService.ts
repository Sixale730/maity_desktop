import { supabase } from '@/lib/supabase'
import type {
  ChatThread,
  ChatMessage,
  ChatMemory,
  ChatSettings,
  SendMessageResult,
  MemoryStatus,
  ChatRole,
} from '../types'

/**
 * Threads
 */

export async function listThreads(userId: string): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ChatThread[]
}

export async function createThread(userId: string, title?: string): Promise<ChatThread> {
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({ user_id: userId, title: title ?? 'Nuevo chat' })
    .select('*')
    .single()

  if (error) throw error
  return data as ChatThread
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('El título no puede estar vacío')

  const { error } = await supabase
    .from('chat_threads')
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq('id', threadId)

  if (error) throw error
}

export async function deleteThread(threadId: string): Promise<void> {
  const { error } = await supabase.from('chat_threads').delete().eq('id', threadId)
  if (error) throw error
}

/**
 * Messages
 */

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

async function insertMessage(
  threadId: string,
  userId: string,
  role: ChatRole,
  content: string,
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ thread_id: threadId, user_id: userId, role, content })
    .select('*')
    .single()

  if (error) throw error
  return data as ChatMessage
}

/**
 * Memories
 */

export async function listMemories(userId: string): Promise<ChatMemory[]> {
  const { data, error } = await supabase
    .from('chat_memories')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'rejected')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ChatMemory[]
}

export async function approveMemory(memoryId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_memories')
    .update({ status: 'approved' satisfies MemoryStatus })
    .eq('id', memoryId)
  if (error) throw error
}

export async function rejectMemory(memoryId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_memories')
    .update({ status: 'rejected' satisfies MemoryStatus })
    .eq('id', memoryId)
  if (error) throw error
}

export async function updateMemoryContent(memoryId: string, content: string): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('La memoria no puede estar vacía')

  const { error } = await supabase
    .from('chat_memories')
    .update({ content: trimmed })
    .eq('id', memoryId)
  if (error) throw error
}

export async function addManualMemory(userId: string, content: string): Promise<ChatMemory> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('La memoria no puede estar vacía')

  const { data, error } = await supabase
    .from('chat_memories')
    .insert({
      user_id: userId,
      content: trimmed,
      status: 'approved' satisfies MemoryStatus,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as ChatMemory
}

/**
 * Settings
 */

export async function getSettings(userId: string): Promise<ChatSettings | null> {
  const { data, error } = await supabase
    .from('chat_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ChatSettings | null
}

export async function setMemoryExtractionPaused(userId: string, paused: boolean): Promise<void> {
  const { error } = await supabase.from('chat_settings').upsert(
    {
      user_id: userId,
      memory_extraction_paused: paused,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

/**
 * LLM call — hits the Vercel route in the web repo (Sixale730/maity).
 *
 * Endpoint:  POST https://www.maity.cloud/api/maity-chat
 * Auth:      Bearer <Supabase access_token>
 * Pattern:   mirrors `api/game-chat.ts` and `api/evaluate.ts` (Zod-validated,
 *            authenticateUser, calls DeepSeek/OpenAI server-side).
 *
 * Request body:
 *   {
 *     thread_id: string
 *     messages: Array<{ role: 'user' | 'assistant'; content: string }>
 *     approved_memories: string[]
 *     language: 'es-419'
 *   }
 *
 * Response:
 *   {
 *     content: string
 *     proposed_memories?: string[]
 *     thread_title?: string
 *   }
 *
 * Falls back to a clearly-marked placeholder if the route is not yet
 * deployed (404) or the user is offline, so the UI (threads, memories,
 * persistence) remains testable end-to-end during rollout.
 */
const MAITY_CHAT_ENDPOINT = 'https://www.maity.cloud/api/maity-chat'

function placeholderReply(
  newUserContent: string,
  approvedMemories: string[],
  reason: 'pending' | 'auth' | 'error',
): { content: string; proposedMemories: string[] } {
  const memoriesNote = approvedMemories.length > 0
    ? `\n\n_(Se enviarían ${approvedMemories.length} memoria(s) aprobada(s) como contexto.)_`
    : ''

  const header =
    reason === 'pending' ? '**Endpoint de IA pendiente de conectar.**'
    : reason === 'auth'  ? '**Sesión expirada.**'
    : '**No se pudo contactar al servicio de IA.**'

  const body =
    reason === 'pending' ? 'En cuanto se despliegue la ruta `/api/maity-chat` en el repo web, responderé con la personalidad de Maity, enfocada en habilidades blandas y productividad.'
    : reason === 'auth'  ? 'Vuelve a iniciar sesión para continuar la conversación.'
    : 'Verifica tu conexión a internet o intenta de nuevo en unos momentos.'

  const placeholder = [
    header,
    '',
    `Recibí tu mensaje: _"${newUserContent.slice(0, 200)}${newUserContent.length > 200 ? '…' : ''}"_`,
    '',
    body,
    memoriesNote,
  ].join('\n')

  return { content: placeholder, proposedMemories: [] }
}

async function generateAssistantReply(params: {
  threadId: string
  history: ChatMessage[]
  newUserContent: string
  approvedMemories: string[]
}): Promise<{ content: string; proposedMemories: string[]; threadTitle?: string }> {
  const { threadId, history, newUserContent, approvedMemories } = params

  const messagesForLLM = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: newUserContent },
  ]

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return placeholderReply(newUserContent, approvedMemories, 'auth')
  }

  try {
    const response = await fetch(MAITY_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        thread_id: threadId,
        messages: messagesForLLM,
        approved_memories: approvedMemories,
        language: 'es-419',
      }),
    })

    if (response.status === 404) {
      return placeholderReply(newUserContent, approvedMemories, 'pending')
    }
    if (response.status === 401 || response.status === 403) {
      return placeholderReply(newUserContent, approvedMemories, 'auth')
    }
    if (!response.ok) {
      return placeholderReply(newUserContent, approvedMemories, 'error')
    }

    const data = (await response.json()) as {
      content?: string
      proposed_memories?: string[]
      thread_title?: string
    }

    if (!data?.content) {
      return placeholderReply(newUserContent, approvedMemories, 'error')
    }

    return {
      content: data.content,
      proposedMemories: data.proposed_memories ?? [],
      threadTitle: data.thread_title,
    }
  } catch {
    return placeholderReply(newUserContent, approvedMemories, 'error')
  }
}

/**
 * Send a message: persists the user turn, calls the LLM Edge Function
 * (with graceful fallback if not yet deployed), persists the assistant
 * turn, and surfaces proposed memories. Returns everything the UI needs
 * in one round-trip.
 */
export async function sendMessage(params: {
  thread: ChatThread
  userId: string
  content: string
  history: ChatMessage[]
  approvedMemories: ChatMemory[]
}): Promise<SendMessageResult> {
  const { thread, userId, content, history, approvedMemories } = params

  const userMessage = await insertMessage(thread.id, userId, 'user', content)

  const {
    content: assistantContent,
    proposedMemories,
    threadTitle: serverTitle,
  } = await generateAssistantReply({
    threadId: thread.id,
    history: [...history, userMessage],
    newUserContent: content,
    approvedMemories: approvedMemories.map((m) => m.content),
  })

  const assistantMessage = await insertMessage(thread.id, userId, 'assistant', assistantContent)

  let threadTitle: string | undefined
  const isFirstExchange = history.length === 0
  const needsTitle = thread.title === 'Nuevo chat' || !thread.title.trim()
  if (isFirstExchange && needsTitle) {
    if (serverTitle && serverTitle.trim()) {
      threadTitle = serverTitle.trim().slice(0, 60)
    } else {
      const candidate = content.trim().split(/\s+/).slice(0, 8).join(' ')
      threadTitle = candidate.length > 60 ? candidate.slice(0, 60).trim() + '…' : candidate
    }
    if (threadTitle) await renameThread(thread.id, threadTitle)
  }

  if (proposedMemories.length > 0) {
    const rows = proposedMemories.map((memContent) => ({
      user_id: userId,
      content: memContent,
      status: 'proposed' satisfies MemoryStatus,
      source_message_id: assistantMessage.id,
    }))
    const { error } = await supabase.from('chat_memories').insert(rows)
    if (error) {
      console.warn('Failed to persist proposed memories:', error)
    }
  }

  return { userMessage, assistantMessage, proposedMemories, threadTitle }
}
