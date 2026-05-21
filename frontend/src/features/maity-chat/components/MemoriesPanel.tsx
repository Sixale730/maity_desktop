'use client'

import { useState } from 'react'
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import type { ChatMemory, ChatSettings } from '../types'

interface MemoriesPanelProps {
  memories: ChatMemory[]
  settings: ChatSettings | null | undefined
  isLoading?: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onUpdate: (id: string, content: string) => void
  onAddManual: (content: string) => void
  onTogglePaused: (paused: boolean) => void
}

function relative(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function MemoriesPanel({
  memories,
  settings,
  isLoading,
  onApprove,
  onReject,
  onUpdate,
  onAddManual,
  onTogglePaused,
}: MemoriesPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [newMemory, setNewMemory] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const proposed = memories.filter((m) => m.status === 'proposed')
  const approved = memories.filter((m) => m.status === 'approved')

  const startEditing = (mem: ChatMemory) => {
    setEditingId(mem.id)
    setEditingContent(mem.content)
  }

  const commitEdit = () => {
    if (!editingId) return
    const trimmed = editingContent.trim()
    if (trimmed) onUpdate(editingId, trimmed)
    setEditingId(null)
  }

  const submitNew = () => {
    const trimmed = newMemory.trim()
    if (!trimmed) return
    onAddManual(trimmed)
    setNewMemory('')
    setShowAdd(false)
  }

  return (
    <div className="w-[320px] flex-shrink-0 border-l border-border bg-background flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Brain className="w-4 h-4 text-[#485df4]" />
        <h2 className="text-sm font-semibold text-foreground">Memorias</h2>
      </div>

      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Extracción automática</p>
          <p className="text-[11px] text-muted-foreground">
            Maity propondrá memorias después de cada chat
          </p>
        </div>
        <Switch
          checked={!settings?.memory_extraction_paused}
          onCheckedChange={(checked) => onTogglePaused(!checked)}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading && memories.length === 0 && (
          <p className="text-xs text-muted-foreground">Cargando...</p>
        )}

        {proposed.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Propuestas ({proposed.length})
            </h3>
            <div className="space-y-2">
              {proposed.map((mem) => (
                <div
                  key={mem.id}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <p className="text-sm text-foreground">{mem.content}</p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => onApprove(mem.id)}
                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      Aprobar
                    </button>
                    <button
                      onClick={() => onReject(mem.id)}
                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors"
                    >
                      <X className="w-3 h-3" />
                      Descartar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Aprobadas ({approved.length})
            </h3>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="text-xs flex items-center gap-1 text-[#485df4] hover:underline"
            >
              <Plus className="w-3 h-3" />
              Agregar
            </button>
          </div>

          {showAdd && (
            <div className="mb-2 rounded-lg border border-border bg-background p-2 space-y-2">
              <textarea
                value={newMemory}
                onChange={(e) => setNewMemory(e.target.value)}
                placeholder="Algo sobre ti que quieres que Maity recuerde..."
                rows={3}
                className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={submitNew}
                  disabled={!newMemory.trim()}
                  className="flex-1 text-xs px-2 py-1 rounded bg-[#485df4] text-white hover:bg-[#3a4fd4] disabled:opacity-40 transition-colors"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setNewMemory('')
                    setShowAdd(false)
                  }}
                  className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {approved.length === 0 && !showAdd && (
            <p className="text-xs text-muted-foreground">
              Aún no hay memorias. Maity las irá creando, o puedes agregarlas manualmente.
            </p>
          )}

          <div className="space-y-2">
            {approved.map((mem) => {
              const isEditing = editingId === mem.id
              return (
                <div
                  key={mem.id}
                  className="group rounded-lg border border-border bg-background p-3"
                >
                  {isEditing ? (
                    <>
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={3}
                        className="w-full resize-none bg-transparent text-sm text-foreground outline-none border border-border rounded p-1"
                        autoFocus
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={commitEdit}
                          className="flex-1 text-xs px-2 py-1 rounded bg-[#485df4] text-white hover:bg-[#3a4fd4] transition-colors"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-foreground">{mem.content}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          {relative(mem.created_at)}
                          {mem.last_used_at && ` · usada ${relative(mem.last_used_at)}`}
                        </span>
                        <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                          <button
                            onClick={() => startEditing(mem)}
                            className="p-1 rounded hover:bg-secondary transition-colors"
                          >
                            <Pencil className="w-3 h-3 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => onReject(mem.id)}
                            className="p-1 rounded hover:bg-secondary transition-colors"
                          >
                            <Trash2 className="w-3 h-3 text-muted-foreground" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
