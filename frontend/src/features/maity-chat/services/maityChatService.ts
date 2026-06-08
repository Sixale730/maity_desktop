import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type {
  ChatThread,
  ChatMessage,
  ChatMemory,
  ChatSettings,
  SendMessageResult,
  MemoryStatus,
  Lens,
} from '../types'

/**
 * Threads
 */

export async function listThreads(userId: string): Promise<ChatThread[]> {
  logger.info('[chat] listThreads', { userId })
  const { data, error } = await supabase
    .schema('maity')
    .from('chat_threads')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    logger.warn('[chat] listThreads error', error)
    throw error
  }
  logger.info('[chat] listThreads result', { count: data?.length ?? 0, userId })
  return (data ?? []) as ChatThread[]
}

export async function createThread(userId: string, title?: string): Promise<ChatThread> {
  const { data, error } = await supabase
    .schema('maity')
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
    .schema('maity')
    .from('chat_threads')
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq('id', threadId)

  if (error) throw error
}

export async function deleteThread(threadId: string): Promise<void> {
  const { error } = await supabase.schema('maity').from('chat_threads').delete().eq('id', threadId)
  if (error) throw error
}

/**
 * Persiste el lente activo del thread en la columna `chat_threads.lens`.
 * El endpoint LLM en Vercel lee este campo en el siguiente sendMessage y
 * prepende LENS_INSTRUCTIONS al system prompt.
 */
export async function updateThreadLens(threadId: string, lens: Lens): Promise<void> {
  const { error } = await supabase
    .schema('maity')
    .from('chat_threads')
    .update({ lens })
    .eq('id', threadId)
  if (error) throw error
}

/**
 * Messages
 */

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .schema('maity')
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return attachToolRows((data ?? []) as ChatMessage[])
}

/**
 * Hidrata los pills inline de tareas/notas de los mensajes del assistant a
 * partir de las filas que las tool-calls crearon en chat_tasks / chat_notes
 * (ligadas por message_id). Reemplaza el viejo path de marker-parsing: las
 * filas creadas por tools no tienen marker en `content`, así que el dato del
 * pill debe venir de las tablas. RLS limita ambas queries al usuario actual.
 * Best-effort: ante un error, los mensajes vuelven sin hidratar (ChatTurn cae
 * al marker-parsing para mensajes viejos).
 */
async function attachToolRows(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const assistantIds = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.id)
  if (assistantIds.length === 0) return messages

  const [tasksRes, notesRes] = await Promise.all([
    supabase
      .schema('maity')
      .from('chat_tasks')
      .select('message_id, content, due_date')
      .in('message_id', assistantIds),
    supabase
      .schema('maity')
      .from('chat_notes')
      .select('message_id, content')
      .in('message_id', assistantIds),
  ])

  if (tasksRes.error || notesRes.error) return messages

  const tasksByMsg = new Map<string, Array<{ description: string; due?: string }>>()
  for (const row of tasksRes.data ?? []) {
    const mid = row.message_id as string
    if (!mid) continue
    const list = tasksByMsg.get(mid) ?? []
    list.push({ description: row.content as string, due: (row.due_date as string) ?? undefined })
    tasksByMsg.set(mid, list)
  }

  const notesByMsg = new Map<string, Array<{ content: string }>>()
  for (const row of notesRes.data ?? []) {
    const mid = row.message_id as string
    if (!mid) continue
    const list = notesByMsg.get(mid) ?? []
    list.push({ content: row.content as string })
    notesByMsg.set(mid, list)
  }

  return messages.map((m) =>
    m.role === 'assistant' && (tasksByMsg.has(m.id) || notesByMsg.has(m.id))
      ? { ...m, tasks: tasksByMsg.get(m.id), notes: notesByMsg.get(m.id) }
      : m,
  )
}

/**
 * Memories
 */

export async function listMemories(userId: string): Promise<ChatMemory[]> {
  const { data, error } = await supabase
    .schema('maity')
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
    .schema('maity')
    .from('chat_memories')
    .update({ status: 'approved' satisfies MemoryStatus })
    .eq('id', memoryId)
  if (error) throw error
}

export async function rejectMemory(memoryId: string): Promise<void> {
  const { error } = await supabase
    .schema('maity')
    .from('chat_memories')
    .update({ status: 'rejected' satisfies MemoryStatus })
    .eq('id', memoryId)
  if (error) throw error
}

export async function updateMemoryContent(memoryId: string, content: string): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('La memoria no puede estar vacía')

  const { error } = await supabase
    .schema('maity')
    .from('chat_memories')
    .update({ content: trimmed })
    .eq('id', memoryId)
  if (error) throw error
}

export async function addManualMemory(userId: string, content: string): Promise<ChatMemory> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('La memoria no puede estar vacía')

  const { data, error } = await supabase
    .schema('maity')
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
    .schema('maity')
    .from('chat_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ChatSettings | null
}

export async function setMemoryExtractionPaused(userId: string, paused: boolean): Promise<void> {
  const { error } = await supabase.schema('maity').from('chat_settings').upsert(
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
 * Endpoint:  POST https://www.maity.cloud/api/maity-chat   (SSE desde 2026-05-26)
 * Auth:      Bearer <Supabase access_token>
 *
 * Request body:
 *   {
 *     thread_id: string
 *     messages: Array<{ role: 'user' | 'assistant'; content: string }>
 *     approved_memories: Array<{ id: string; content: string }>
 *     language: 'es-419'
 *     client_idempotency_key: string  // uuid, for safe retries
 *     lens?: 'open'|'ask'|'mirror'|'push'|'sum'
 *   }
 *
 * Response (text/event-stream):
 *   event: chunk → { delta: string }                          (token a token)
 *   event: done  → { assistant_id, content, proposed_memories?, thread_title? }
 *   event: error → { message }
 *
 * El endpoint persiste TODO server-side (los 2 mensajes idempotentes por
 * (user_id, client_idempotency_key, role), las memorias propuestas, y el
 * título del thread). El cliente NO inserta nada: solo consume el stream y
 * re-lee las filas canónicas por idempotency key (`fetchLatestPair`).
 *
 * IMPORTANTE: el origin `https://www.maity.cloud` debe estar en `connect-src`
 * del CSP en `frontend/src-tauri/tauri.conf.json` o Tauri bloquea el fetch.
 */
const MAITY_CHAT_ENDPOINT = 'https://www.maity.cloud/api/maity-chat'

/**
 * Genera un idempotency key fresco para un intento de envío.
 * Exportado para que los tests puedan fijar un valor.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

interface DoneEvent {
  assistant_id: string
  content: string
  proposed_memories?: string[]
  thread_title?: string
}

interface AssistantReply {
  content: string
  proposedMemories: string[]
  threadTitle?: string
  idempotencyKey: string
}

/**
 * Consume el stream SSE del endpoint: despacha cada `event: chunk` a
 * `onDelta` y resuelve con el payload consolidado cuando llega `event: done`.
 *
 * El parseo es deliberadamente simple: separa el stream de bytes por la
 * línea en blanco que delimita eventos, luego divide cada evento en sus
 * líneas `event:` y `data:`. El endpoint siempre manda JSON de una sola
 * línea en `data:`, así que no hace falta reensamblar data multilínea.
 */
async function callEndpoint(params: {
  threadId: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  approvedMemories: ChatMemory[]
  idempotencyKey: string
  lens: Lens
  attachments?: Array<{ filename: string; text: string }>
  onDelta?: (delta: string) => void
}): Promise<AssistantReply> {
  const { threadId, history, approvedMemories, idempotencyKey, lens, attachments, onDelta } = params

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Sesión no disponible. Vuelve a iniciar sesión.')

  // Reportamos la zona horaria IANA del cliente para que el servidor ancle
  // "hoy"/"ayer"/"esta semana" a la fecha local del usuario en vez de UTC.
  // Siempre disponible en el webview; el guard deja que un runtime no estándar
  // simplemente lo omita.
  const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const res = await fetch(MAITY_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      thread_id: threadId,
      messages: history,
      approved_memories: approvedMemories.map((m) => ({ id: m.id, content: m.content })),
      language: 'es-419',
      client_idempotency_key: idempotencyKey,
      lens,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(clientTimezone ? { client_timezone: clientTimezone } : {}),
    }),
  })

  if (res.status === 401 || res.status === 403) {
    logger.warn('[chat] api/maity-chat auth rejected', { status: res.status })
    throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.')
  }
  if (res.status === 402) {
    // Quota del plan excedida (assertQuota 'maity_chat', Free 50/día). Distinto
    // del 429 (rate limit): aquí el usuario llegó al tope diario de su plan.
    logger.warn('[chat] api/maity-chat quota exceeded (plan limit)')
    throw new Error(
      'Alcanzaste tu límite de mensajes del plan Free de hoy. Vuelve mañana o mejora tu plan para seguir conversando.',
    )
  }
  if (res.status === 429) {
    logger.warn('[chat] api/maity-chat rate limited')
    throw new Error('Demasiados mensajes seguidos. Espera un momento antes de intentar de nuevo.')
  }
  if (!res.ok || !res.body) {
    logger.warn('[chat] api/maity-chat non-OK response', { status: res.status })
    throw new Error('No se pudo contactar al asistente. Intenta de nuevo.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done: DoneEvent | null = null
  let serverError: string | null = null

  // Drenamos el stream hasta que cierre la conexión. Los eventos
  // `done`/`error` setean las variables locales; no rompemos el loop
  // antes de tiempo para siempre agotar el reader (evita leaks).
  for (;;) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })

    // Separa los eventos completos (terminados por una línea en blanco).
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (!rawEvent.trim()) continue

      let eventName = 'message'
      let dataLine = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
      }
      if (!dataLine) continue

      try {
        const data = JSON.parse(dataLine) as Record<string, unknown>
        if (eventName === 'chunk' && typeof data.delta === 'string') {
          onDelta?.(data.delta)
        } else if (eventName === 'done') {
          done = data as unknown as DoneEvent
        } else if (eventName === 'error') {
          serverError = (data.message as string) || 'stream_error'
        }
      } catch {
        // Ignora líneas de evento malformadas — las siguientes pueden parsear bien.
      }
    }
  }

  if (serverError) {
    logger.warn('[chat] api/maity-chat stream error', { serverError })
    throw new Error('No se pudo completar la respuesta. Intenta de nuevo.')
  }
  if (!done || !done.content) {
    throw new Error('Respuesta vacía del asistente.')
  }
  return {
    content: done.content,
    proposedMemories: done.proposed_memories ?? [],
    threadTitle: done.thread_title,
    idempotencyKey,
  }
}

/**
 * Re-lee las filas que el endpoint persistió server-side (el endpoint hace
 * el INSERT idempotente en `chat_messages`, devolviendo el contenido pero no
 * las filas). Tras una llamada exitosa, re-listamos los mensajes de este
 * thread con el mismo `client_idempotency_key` para obtener las filas canónicas.
 */
async function fetchLatestPair(
  threadId: string,
  idempotencyKey: string,
): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
  const { data, error } = await supabase
    .schema('maity')
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('client_idempotency_key', idempotencyKey)
    .order('created_at', { ascending: true })

  if (error) throw error
  const rows = (data ?? []) as ChatMessage[]

  const userMessage = rows.find((r) => r.role === 'user')
  const assistantMessage = rows.find((r) => r.role === 'assistant')
  if (!userMessage || !assistantMessage) {
    throw new Error('No se pudo recuperar el mensaje guardado.')
  }
  // Hidrata los pills de tareas/notas creados por tools en el turno assistant.
  const [hydratedAssistant] = await attachToolRows([assistantMessage])
  return { userMessage, assistantMessage: hydratedAssistant ?? assistantMessage }
}

/**
 * Envía un mensaje del chat. La persistencia es 100% server-side: el endpoint
 * inserta ambas filas idempotentemente (keyed por `client_idempotency_key`),
 * persiste las memorias propuestas y el título del thread. En el cliente solo
 * entregamos la petición al endpoint (consumiendo el stream SSE) y re-leemos
 * las filas resultantes. Los reintentos reusan el mismo idempotency key → sin
 * duplicados.
 *
 * `onDelta` (opcional) se invoca por cada token a medida que se genera la
 * respuesta. El texto completo también vuelve en el resultado, así que un
 * caller que no quiera UI incremental puede ignorarlo.
 */
export async function sendMessage(params: {
  thread: ChatThread
  userId: string
  content: string
  history: ChatMessage[]
  approvedMemories: ChatMemory[]
  /** Texto extraído de archivos adjuntos, inyectado como contexto server-side. */
  attachments?: Array<{ filename: string; text: string }>
  onDelta?: (delta: string) => void
}): Promise<SendMessageResult> {
  const { thread, content, history, approvedMemories, attachments, onDelta } = params

  const idempotencyKey = newIdempotencyKey()

  const historyForEndpoint = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content },
  ]

  const reply = await callEndpoint({
    threadId: thread.id,
    history: historyForEndpoint,
    approvedMemories,
    idempotencyKey,
    lens: thread.lens ?? 'open',
    attachments,
    onDelta,
  })

  const { userMessage, assistantMessage } = await fetchLatestPair(thread.id, idempotencyKey)

  return {
    userMessage,
    assistantMessage,
    proposedMemories: reply.proposedMemories,
    threadTitle: reply.threadTitle,
  }
}
