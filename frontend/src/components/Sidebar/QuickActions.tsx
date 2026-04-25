'use client';

import React from 'react';
import { FileDown, Search, Sparkles, Mic } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useSidebar } from './SidebarProvider';

interface QuickActionsProps {
  isCollapsed: boolean;
  onFocusSearch?: () => void;
  onToggleCoach?: () => void;
  onStartRecording?: () => void;
}

interface ActionDef {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Quick Action Cards — atajos a flujos comunes inspirados en patrón Director (agents-as-cards).
 *
 * Cuando colapsado: solo iconos en columna vertical con tooltip via title.
 * Cuando expandido: icono + label + descripción.
 */
export function QuickActions({
  isCollapsed,
  onFocusSearch,
  onToggleCoach,
  onStartRecording,
}: QuickActionsProps) {
  const { currentMeeting, handleRecordingToggle } = useSidebar();
  const { isRecording } = useRecordingState();

  const handleExport = async () => {
    if (!currentMeeting?.id) {
      toast.error('Selecciona una reunión primero');
      return;
    }
    try {
      await invoke('export_meeting', {
        meeting_id: currentMeeting.id,
        format: 'pdf',
      });
      toast.success('Reunión exportada como PDF');
    } catch (e) {
      toast.error(`Error exportando: ${e}`);
    }
  };

  const handleStart = () => {
    if (onStartRecording) {
      onStartRecording();
    } else {
      handleRecordingToggle();
    }
  };

  const actions: ActionDef[] = [
    {
      id: 'new-recording',
      label: isRecording ? 'Detener' : 'Nueva',
      description: isRecording ? 'Detener grabación' : 'Iniciar reunión',
      icon: <Mic className="w-4 h-4" />,
      onClick: handleStart,
    },
    {
      id: 'export',
      label: 'Exportar',
      description: 'PDF de reunión actual',
      icon: <FileDown className="w-4 h-4" />,
      onClick: handleExport,
      disabled: !currentMeeting?.id,
      disabledReason: 'Selecciona una reunión',
    },
    {
      id: 'search',
      label: 'Buscar',
      description: 'En transcripciones',
      icon: <Search className="w-4 h-4" />,
      onClick: () => onFocusSearch?.(),
    },
    {
      id: 'coach',
      label: 'Coach IA',
      description: 'Tips de la sesión',
      icon: <Sparkles className="w-4 h-4" />,
      onClick: () => onToggleCoach?.(),
      disabled: !isRecording,
      disabledReason: 'Solo durante grabación',
    },
  ];

  if (isCollapsed) {
    return (
      <nav
        aria-label="Acciones rápidas"
        className="flex flex-col items-center gap-1 py-2 border-t border-gray-700/30"
      >
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled}
            title={a.disabled ? a.disabledReason ?? a.description : a.description}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700/40 hover:text-gray-50 transition disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            {a.icon}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-gray-700/30">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">
        Acciones rápidas
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled}
            title={a.disabled ? a.disabledReason ?? a.description : a.description}
            className="flex flex-col items-start gap-1 p-2 rounded-lg bg-gray-800/40 hover:bg-gray-700/60 transition text-left disabled:opacity-40 disabled:hover:bg-gray-800/40 disabled:cursor-not-allowed"
          >
            <div className="text-gray-200">{a.icon}</div>
            <div className="text-xs font-medium text-gray-100 leading-tight">{a.label}</div>
            <div className="text-[10px] text-gray-400 leading-tight">{a.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
