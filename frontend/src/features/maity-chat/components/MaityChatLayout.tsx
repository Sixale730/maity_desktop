'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Brain, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { ChatThreadList } from './ChatThreadList'
import { ChatThreadView } from './ChatThreadView'
import { ComposerInput } from './ComposerInput'
import { MemoriesPanel } from './MemoriesPanel'
import {
  useCreateThread,
  useDeleteThread,
  useRenameThread,
  useThreads,
} from '../hooks/useThreads'
import { useMessages, useSendMessage } from '../hooks/useMessages'
import {
  useAddManualMemory,
  useApproveMemory,
  useChatSettings,
  useMemories,
  useRejectMemory,
  useSetMemoryExtractionPaused,
  useUpdateMemoryContent,
} from '../hooks/useMemories'

export function MaityChatLayout() {
  const { maityUser } = useAuth()
  const userId = maityUser?.id

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [memoriesOpen, setMemoriesOpen] = useState(false)

  const threadsQuery = useThreads(userId)
  const createThread = useCreateThread(userId)
  const renameThread = useRenameThread(userId)
  const deleteThread = useDeleteThread(userId)

  const messagesQuery = useMessages(activeThreadId ?? undefined)
  const sendMessage = useSendMessage(userId)

  const memoriesQuery = useMemories(userId)
  const settingsQuery = useChatSettings(userId)
  const approveMemory = useApproveMemory(userId)
  const rejectMemory = useRejectMemory(userId)
  const updateMemory = useUpdateMemoryContent(userId)
  const addMemory = useAddManualMemory(userId)
  const setPaused = useSetMemoryExtractionPaused(userId)

  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data])
  const memories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data])
  const approvedMemories = useMemo(
    () => memories.filter((m) => m.status === 'approved'),
    [memories],
  )
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )

  useEffect(() => {
    if (!activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id)
    }
  }, [threads, activeThreadId])

  const handleNew = async () => {
    const thread = await createThread.mutateAsync()
    setActiveThreadId(thread.id)
  }

  const handleSelect = (threadId: string) => {
    setActiveThreadId(threadId)
  }

  const handleDelete = async (threadId: string) => {
    await deleteThread.mutateAsync(threadId)
    if (activeThreadId === threadId) {
      setActiveThreadId(null)
    }
  }

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || sendMessage.isPending) return

    let thread = activeThread
    if (!thread) {
      thread = await createThread.mutateAsync()
      setActiveThreadId(thread.id)
    }

    setInput('')
    await sendMessage.mutateAsync({
      thread,
      content,
      history: messages,
      approvedMemories,
    })
  }

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center bg-muted">
        <div className="max-w-sm text-center p-6">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#485df4]/10 flex items-center justify-center mb-3">
            <Bot className="w-6 h-6 text-[#485df4]" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Chat IA</h2>
          <p className="text-sm text-muted-foreground">
            Inicia sesión para conversar con Maity y guardar tus memorias.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex bg-muted">
      <ChatThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        isLoading={threadsQuery.isLoading}
        isCreating={createThread.isPending}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={(id, title) => renameThread.mutate({ threadId: id, title })}
        onDelete={handleDelete}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-6 pt-5 pb-3 flex-shrink-0 flex items-center justify-between border-b border-border bg-background/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#485df4]/10 flex-shrink-0">
              <Bot className="h-5 w-5 text-[#485df4]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-foreground truncate">
                {activeThread?.title ?? 'Chat IA'}
              </h1>
              <p className="text-xs text-muted-foreground">
                Tu coach de habilidades blandas y productividad
              </p>
            </div>
          </div>
          <button
            onClick={() => setMemoriesOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-secondary transition-colors text-foreground"
          >
            {memoriesOpen ? (
              <PanelRightClose className="w-3.5 h-3.5" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5" />
            )}
            <Brain className="w-3.5 h-3.5 text-[#485df4]" />
            Memorias {approvedMemories.length > 0 ? `· ${approvedMemories.length}` : ''}
          </button>
        </div>

        <ChatThreadView
          messages={messages}
          isLoading={messagesQuery.isLoading}
          isSending={sendMessage.isPending}
          onSuggestionClick={(text) => handleSend(text)}
        />

        <div className="px-6 pb-6 pt-2 flex-shrink-0 max-w-3xl w-full mx-auto">
          <ComposerInput
            value={input}
            onChange={setInput}
            onSend={() => handleSend()}
            disabled={sendMessage.isPending}
            isSending={sendMessage.isPending}
          />
          <p className="text-xs text-muted-foreground mt-1.5 text-center">
            Maity recuerda tus memorias aprobadas y usa contexto de tus chats.
          </p>
        </div>
      </div>

      {memoriesOpen && (
        <MemoriesPanel
          memories={memories}
          settings={settingsQuery.data}
          isLoading={memoriesQuery.isLoading}
          onApprove={(id) => approveMemory.mutate(id)}
          onReject={(id) => rejectMemory.mutate(id)}
          onUpdate={(id, content) => updateMemory.mutate({ memoryId: id, content })}
          onAddManual={(content) => addMemory.mutate(content)}
          onTogglePaused={(paused) => setPaused.mutate(paused)}
        />
      )}
    </div>
  )
}
