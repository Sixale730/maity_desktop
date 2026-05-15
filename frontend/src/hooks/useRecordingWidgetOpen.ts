import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Estado reactivo de la ventana flotante coach-float (la única ventana
 * flotante de la app desde la iteración 4).
 *
 * Devuelve `null` durante el primer paint mientras se resuelve el estado
 * inicial vía `is_coach_float_open`. Los consumidores deben tratar `null`
 * como "todavía desconocido" — útil para evitar parpadeos en UIs que
 * dependen de la visibilidad del flotante.
 *
 * El nombre del hook se mantiene como `useRecordingWidgetOpen` por
 * compatibilidad con los consumidores existentes (FAB, page.tsx) — pero
 * internamente apunta al coach-float, que es la nueva fuente de verdad.
 *
 * Se mantiene sincronizado escuchando el evento
 * `coach-float-visibility-changed` que emite el backend Rust al
 * abrir/cerrar la ventana desde cualquier path (X, tray, Settings, FAB).
 */
export function useRecordingWidgetOpen(): boolean | null {
  const [widgetOpen, setWidgetOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<boolean>('is_coach_float_open')
      .then((open) => { if (!cancelled) setWidgetOpen(open); })
      // Si falla, asumir abierto: en el peor caso ocultamos `RecordingControls`
      // pero el FAB también permanecerá oculto — el usuario nunca queda sin
      // entrada a la app (sigue la ruta del coach-float mismo o tray).
      .catch(() => { if (!cancelled) setWidgetOpen(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unlistenP = listen<{ visible: boolean }>(
      'coach-float-visibility-changed',
      (e) => setWidgetOpen(e.payload.visible),
    );
    return () => { unlistenP.then(fn => fn()); };
  }, []);

  return widgetOpen;
}
