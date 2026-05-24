'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreVertical, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ChatThread } from '../types'

interface ChatThreadListProps {
  threads: ChatThread[]
  activeThreadId: string | null
  isLoading?: boolean
  onSelect: (threadId: string) => void
  onNew: () => void
  onRename: (threadId: string, title: string) => void
  onDelete: (threadId: string) => void
  isCreating?: boolean
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    }
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 7) {
      return d.toLocaleDateString('es-MX', { weekday: 'short' })
    }
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function ChatThreadList({
  threads,
  activeThreadId,
  isLoading,
  onSelect,
  onNew,
  onRename,
  onDelete,
  isCreating,
}: ChatThreadListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingId])

  const startEditing = (thread: ChatThread) => {
    setEditingId(thread.id)
    setDraftTitle(thread.title)
  }

  const commitEdit = () => {
    if (!editingId) return
    const trimmed = draftTitle.trim()
    if (trimmed) onRename(editingId, trimmed)
    setEditingId(null)
  }

  return (
    <div className="w-[260px] flex-shrink-0 border-r border-border bg-background flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <button
          onClick={onNew}
          disabled={isCreating}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#485df4] hover:bg-[#3a4fd4] disabled:opacity-50 px-3 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {isLoading && threads.length === 0 && (
          <div className="px-4 py-3 text-xs text-muted-foreground">Cargando...</div>
        )}
        {!isLoading && threads.length === 0 && (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            Aún no tienes chats. Crea uno nuevo para empezar.
          </div>
        )}

        {threads.map((thread) => {
          const isActive = thread.id === activeThreadId
          const isEditing = editingId === thread.id
          return (
            <div
              key={thread.id}
              onClick={() => !isEditing && onSelect(thread.id)}
              className={`group mx-2 my-0.5 px-3 py-2 rounded-lg cursor-pointer flex items-center gap-2 ${
                isActive ? 'bg-secondary' : 'hover:bg-secondary/60'
              }`}
            >
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="w-full bg-transparent border border-border rounded px-1 py-0.5 text-sm text-foreground outline-none focus:border-[#485df4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p className="text-sm font-medium text-foreground truncate">{thread.title}</p>
                )}
                <p className="text-[11px] text-muted-foreground">{formatDate(thread.updated_at)}</p>
              </div>

              {!isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/60"
                    >
                      <MoreVertical className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => startEditing(thread)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Renombrar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (confirm(`¿Eliminar "${thread.title}"? Esta acción no se puede deshacer.`)) {
                          onDelete(thread.id)
                        }
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
