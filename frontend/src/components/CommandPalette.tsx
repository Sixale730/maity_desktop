'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, FileDown, Mic, MicOff, Sparkles, Settings,
  Trash2, RefreshCw, FileText, Command as CmdIcon, ChevronRight,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSidebar } from './Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';

export type CommandId =
  | 'new-recording'
  | 'stop-recording'
  | 'export-pdf'
  | 'export-md'
  | 'export-json'
  | 'open-settings'
  | 'search-meetings'
  | 'semantic-search'
  | 'toggle-coach'
  | 'go-home'
  | 'reload'
  | 'clear-cache';

interface CommandDef {
  id: CommandId;
  slash: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  keywords?: string[];
  group: 'Reunión' | 'Exportar' | 'Navegación' | 'Sistema';
  enabled?: () => boolean;
  action: () => void | Promise<void>;
}

interface CommandPaletteProps {
  onClose: () => void;
}

/**
 * CommandPalette — paleta de comandos estilo Cmd+K (patrón Director: chat con slash commands).
 *
 * Trigger: Ctrl+K / Cmd+K abre, ESC cierra. Filtrado fuzzy por slash o por keywords.
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { currentMeeting, handleRecordingToggle, refetchMeetings } = useSidebar();
  const { isRecording } = useRecordingState();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const exportFormat = useCallback(
    async (format: 'pdf' | 'markdown' | 'json') => {
      if (!currentMeeting?.id) {
        toast.error('Selecciona una reunión primero');
        return;
      }
      try {
        await invoke('export_meeting', { meeting_id: currentMeeting.id, format });
        toast.success(`Exportado como ${format.toUpperCase()}`);
      } catch (e) {
        toast.error(`Error: ${e}`);
      }
    },
    [currentMeeting?.id]
  );

  const commands = useMemo<CommandDef[]>(
    () => [
      {
        id: 'new-recording',
        slash: '/new',
        label: 'Nueva reunión',
        description: 'Iniciar grabación',
        icon: <Mic className="w-4 h-4" />,
        keywords: ['record', 'start', 'iniciar', 'grabar'],
        group: 'Reunión',
        enabled: () => !isRecording,
        action: () => handleRecordingToggle(),
      },
      {
        id: 'stop-recording',
        slash: '/stop',
        label: 'Detener reunión',
        description: 'Finalizar grabación actual',
        icon: <MicOff className="w-4 h-4" />,
        keywords: ['stop', 'finalizar', 'terminar'],
        group: 'Reunión',
        enabled: () => isRecording,
        action: () => handleRecordingToggle(),
      },
      {
        id: 'toggle-coach',
        slash: '/coach',
        label: 'Coach IA',
        description: 'Tips y sugerencias en vivo',
        icon: <Sparkles className="w-4 h-4" />,
        keywords: ['ai', 'sales', 'tips'],
        group: 'Reunión',
        action: () => {
          toast.info('Coach IA visible solo durante grabación activa');
        },
      },
      {
        id: 'export-pdf',
        slash: '/export-pdf',
        label: 'Exportar PDF',
        description: 'Reunión actual a PDF',
        icon: <FileDown className="w-4 h-4" />,
        keywords: ['pdf', 'descargar'],
        group: 'Exportar',
        enabled: () => !!currentMeeting?.id,
        action: () => exportFormat('pdf'),
      },
      {
        id: 'export-md',
        slash: '/export-md',
        label: 'Exportar Markdown',
        description: 'Transcripción como .md',
        icon: <FileText className="w-4 h-4" />,
        keywords: ['markdown', 'md'],
        group: 'Exportar',
        enabled: () => !!currentMeeting?.id,
        action: () => exportFormat('markdown'),
      },
      {
        id: 'export-json',
        slash: '/export-json',
        label: 'Exportar JSON',
        description: 'Estructura completa',
        icon: <FileText className="w-4 h-4" />,
        keywords: ['json', 'datos'],
        group: 'Exportar',
        enabled: () => !!currentMeeting?.id,
        action: () => exportFormat('json'),
      },
      {
        id: 'search-meetings',
        slash: '/search',
        label: 'Buscar (texto exacto)',
        description: 'Búsqueda literal en sidebar',
        icon: <Search className="w-4 h-4" />,
        keywords: ['find', 'buscar', 'encontrar'],
        group: 'Navegación',
        action: () => {
          const el = document.querySelector<HTMLInputElement>('input[placeholder*="Buscar"]');
          el?.focus();
        },
      },
      {
        id: 'semantic-search',
        slash: '/find',
        label: 'Búsqueda semántica',
        description: 'Pregunta natural sobre transcripciones',
        icon: <Sparkles className="w-4 h-4" />,
        keywords: ['embedding', 'semantic', 'natural', 'pregunta'],
        group: 'Navegación',
        action: () => router.push('/search'),
      },
      {
        id: 'go-home',
        slash: '/home',
        label: 'Inicio',
        description: 'Volver a la pantalla principal',
        icon: <ChevronRight className="w-4 h-4" />,
        group: 'Navegación',
        action: () => router.push('/'),
      },
      {
        id: 'open-settings',
        slash: '/settings',
        label: 'Configuración',
        description: 'Modelos, dispositivos, prompts',
        icon: <Settings className="w-4 h-4" />,
        keywords: ['config', 'preferences', 'opciones'],
        group: 'Navegación',
        action: () => router.push('/settings'),
      },
      {
        id: 'reload',
        slash: '/reload',
        label: 'Recargar lista de reuniones',
        description: 'Refrescar sidebar',
        icon: <RefreshCw className="w-4 h-4" />,
        keywords: ['refresh', 'refrescar'],
        group: 'Sistema',
        action: () => {
          refetchMeetings?.();
          toast.success('Lista actualizada');
        },
      },
      {
        id: 'clear-cache',
        slash: '/clear-cache',
        label: 'Limpiar reuniones guardadas viejas',
        description: 'Borra del IndexedDB lo persistido hace +24h',
        icon: <Trash2 className="w-4 h-4" />,
        keywords: ['cache', 'clean', 'limpiar'],
        group: 'Sistema',
        action: async () => {
          try {
            const { indexedDBService } = await import('@/services/indexedDBService');
            const removed = await indexedDBService.deleteSavedMeetings(24);
            toast.success(`Limpieza completada: ${removed} reuniones`);
          } catch (e) {
            toast.error(`Error: ${e}`);
          }
        },
      },
    ],
    [isRecording, currentMeeting?.id, handleRecordingToggle, exportFormat, router, refetchMeetings]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      if (c.slash.toLowerCase().includes(q)) return true;
      if (c.label.toLowerCase().includes(q)) return true;
      if (c.description.toLowerCase().includes(q)) return true;
      if (c.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query, commands]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = useCallback(
    async (cmd: CommandDef) => {
      if (cmd.enabled && !cmd.enabled()) {
        toast.error('Comando no disponible en este contexto');
        return;
      }
      onClose();
      await cmd.action();
    },
    [onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) execute(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CommandDef[]>();
    for (const c of filtered) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-gray-900 w-full max-w-xl mx-4 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <CmdIcon className="w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un comando o /atajo… (↑↓ navegar, Enter ejecutar)"
              className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
              ESC
            </kbd>
          </div>

          <div className="max-h-[50vh] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Sin coincidencias para “{query}”
              </div>
            )}
            {grouped.map(([group, items]) => (
              <div key={group}>
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {group}
                </div>
                {items.map((cmd) => {
                  const idx = filtered.indexOf(cmd);
                  const active = idx === activeIndex;
                  const disabled = cmd.enabled && !cmd.enabled();
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => execute(cmd)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      disabled={disabled}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-900/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                      } ${disabled ? 'opacity-40' : ''}`}
                    >
                      <span className="text-gray-500 dark:text-gray-400">{cmd.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {cmd.label}
                          </span>
                          <code className="text-[10px] font-mono text-gray-400">{cmd.slash}</code>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {cmd.description}
                        </div>
                      </div>
                      {active && (
                        <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 flex items-center justify-between">
            <span>Maity Command Palette</span>
            <span className="font-mono">Ctrl+K para abrir</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Hook que registra Ctrl+K / Cmd+K para abrir la paleta. Devuelve estado controlado.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
