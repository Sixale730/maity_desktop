import { useState } from 'react';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Switch } from '@/ui/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ChatMemory, ChatSettings } from '../types';

interface MemoriesOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: ChatMemory[];
  settings: ChatSettings | null | undefined;
  isLoading?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, content: string) => void;
  onAddManual: (content: string) => void;
  onTogglePaused: (paused: boolean) => void;
}

function relative(iso: string | null, lang: 'es' | 'en'): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const locale = lang === 'en' ? 'en-US' : 'es-MX';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

/**
 * Right-side drawer that opens when the user clicks "Memorias · N" in the
 * TopBar. Replaces the always-on `MemoriesPanel` from the old layout — same
 * data + handlers, presented as a Radix Sheet (overlay) so the conversation
 * has more horizontal room when memories aren't being managed.
 */
export function MemoriesOverlay({
  open,
  onOpenChange,
  memories,
  settings,
  isLoading,
  onApprove,
  onReject,
  onUpdate,
  onAddManual,
  onTogglePaused,
}: MemoriesOverlayProps) {
  const { language, t } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const proposed = memories.filter((m) => m.status === 'proposed');
  const approved = memories.filter((m) => m.status === 'approved');

  const startEditing = (mem: ChatMemory) => {
    setEditingId(mem.id);
    setEditingContent(mem.content);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const trimmed = editingContent.trim();
    if (trimmed) onUpdate(editingId, trimmed);
    setEditingId(null);
  };

  const submitNew = () => {
    const trimmed = newMemory.trim();
    if (!trimmed) return;
    onAddManual(trimmed);
    setNewMemory('');
    setShowAdd(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border flex-row items-center gap-2 space-y-0">
          <Brain className="w-4 h-4 text-maity-blue" strokeWidth={1.8} />
          <SheetTitle className="text-sm font-semibold text-foreground">
            {t('chat.memories')}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-foreground">
              {t('chat.memories_extraction')}
            </p>
            <p className="text-[11px] text-foreground/60">
              {t('chat.memories_extraction_hint')}
            </p>
          </div>
          <Switch
            checked={!settings?.memory_extraction_paused}
            onCheckedChange={(checked) => onTogglePaused(!checked)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && memories.length === 0 && (
            <p className="text-xs text-foreground/60">{t('chat.loading')}</p>
          )}

          {proposed.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-wide mb-2">
                {t('chat.memories_proposed')} ({proposed.length})
              </h3>
              <div className="space-y-2">
                {proposed.map((mem) => (
                  <div
                    key={mem.id}
                    className="rounded-lg border border-maity-amber/30 bg-maity-amber/5 p-3"
                  >
                    <p className="text-sm text-foreground">{mem.content}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => onApprove(mem.id)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded bg-maity-green/10 text-maity-green hover:bg-maity-green/20 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        {t('chat.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(mem.id)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded bg-card text-foreground/60 hover:bg-card-hi transition-colors"
                      >
                        <X className="w-3 h-3" />
                        {t('chat.discard')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-wide">
                {t('chat.memories_approved')} ({approved.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowAdd((v) => !v)}
                className="text-xs flex items-center gap-1 text-maity-blue hover:underline"
              >
                <Plus className="w-3 h-3" />
                {t('chat.add')}
              </button>
            </div>

            {showAdd && (
              <div className="mb-2 rounded-lg border border-border bg-background p-2 space-y-2">
                <textarea
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder={t('chat.add_memory_placeholder')}
                  rows={3}
                  className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground/40 outline-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={submitNew}
                    disabled={!newMemory.trim()}
                    className="flex-1 text-xs px-2 py-1 rounded bg-maity-blue text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {t('chat.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewMemory('');
                      setShowAdd(false);
                    }}
                    className="text-xs px-2 py-1 rounded bg-card text-foreground/60 hover:bg-card-hi transition-colors"
                  >
                    {t('chat.cancel')}
                  </button>
                </div>
              </div>
            )}

            {approved.length === 0 && !showAdd && (
              <p className="text-xs text-foreground/60">{t('chat.no_memories')}</p>
            )}

            <div className="space-y-2">
              {approved.map((mem) => {
                const isEditing = editingId === mem.id;
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
                            type="button"
                            onClick={commitEdit}
                            className="flex-1 text-xs px-2 py-1 rounded bg-maity-blue text-white hover:opacity-90 transition-opacity"
                          >
                            {t('chat.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs px-2 py-1 rounded bg-card text-foreground/60 hover:bg-card-hi transition-colors"
                          >
                            {t('chat.cancel')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-foreground">{mem.content}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[10px] text-foreground/60">
                            {relative(mem.created_at, language)}
                            {mem.last_used_at
                              && ` · ${t('chat.last_used')} ${relative(
                                mem.last_used_at,
                                language,
                              )}`}
                          </span>
                          <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                            <button
                              type="button"
                              onClick={() => startEditing(mem)}
                              className="p-1 rounded hover:bg-card transition-colors"
                              aria-label={t('chat.edit')}
                            >
                              <Pencil className="w-3 h-3 text-foreground/60" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onReject(mem.id)}
                              className="p-1 rounded hover:bg-card transition-colors"
                              aria-label={t('chat.delete')}
                            >
                              <Trash2 className="w-3 h-3 text-foreground/60" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
