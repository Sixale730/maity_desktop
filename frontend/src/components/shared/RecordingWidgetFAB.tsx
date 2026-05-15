'use client';

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mic } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRecordingWidgetOpen } from '@/hooks/useRecordingWidgetOpen';

/**
 * Botón flotante (FAB) dentro de la main window que aparece SÓLO cuando el
 * widget flotante externo (ventana Tauri "recording-widget") está cerrado.
 *
 * Sirve como ruta de recuperación si el usuario cerró el widget con la X y
 * no encuentra cómo reabrirlo. Click → llama el handler canónico que también
 * usan Settings y el tray.
 */
export function RecordingWidgetFAB() {
  const widgetOpen = useRecordingWidgetOpen();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Abre el coach-float en modo compact (idle): la única ventana flotante
      // de la app. Persiste preferencia visible=true para que reaparezca en
      // futuros arranques.
      await invoke('coach_float_set_visibility_pref', {
        visible: true,
        startCompact: true,
      });
    } catch (e) {
      console.warn('FAB: failed to open coach-float', e);
    } finally {
      setBusy(false);
    }
  };

  // Render nada si el widget está abierto o si el estado aún no se determinó.
  if (widgetOpen !== false) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          disabled={busy}
          className="fixed bottom-4 right-4 z-50 flex items-center justify-center w-12 h-12 rounded-full bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white shadow-lg shadow-red-500/40 transition-all hover:scale-105 active:scale-95"
          aria-label="Mostrar coach flotante"
        >
          <Mic className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        Mostrar coach flotante
      </TooltipContent>
    </Tooltip>
  );
}
