'use client';

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';

/**
 * Payload opcional del evento `widget-request-start-recording`. El coach-float
 * envía `null` (iter 4/5) o un objeto con devices (iter 6). Si llega con
 * devices, sobrescribimos el ConfigContext ANTES de disparar el handler de
 * recording start — así `useRecordingStart` lee los devices custom.
 */
interface WidgetStartPayload {
  micDevice?: string | null;
  sysDevice?: string | null;
}

/**
 * Listener global del evento `widget-request-start-recording` emitido por el
 * comando Rust `coach_float_request_start[_with_devices]` cuando el usuario
 * hace click en el botón "Grabar" del coach-float (o flotante equivalente).
 *
 * Vivía antes en `app/page.tsx` (componente Home), pero eso significaba que
 * sólo estaba activo en la ruta `/`. Cuando el flotante se usaba desde otra
 * ruta (o cuando la main window estaba minimizada y Chromium suspendía el
 * webview), el evento se perdía y el usuario necesitaba apretar dos veces
 * Grabar. Moviéndolo aquí — dentro de AppContent, donde están todos los
 * providers necesarios — garantizamos que el listener está montado desde el
 * primer paint post-auth, sin importar la ruta.
 *
 * Reusa `useRecordingStart` para que el flujo canónico (validar Deepgram
 * proxy, Parakeet ready, contextos React, analytics) se ejecute igual que
 * cuando el usuario aprieta el botón en el `RecordingControls` de la home.
 *
 * Iter 6: si el payload trae `micDevice/sysDevice`, los aplicamos al
 * `ConfigContext.selectedDevices` antes de disparar handleRecordingStart.
 */
export function RecordingWidgetListener() {
  const { isRecording } = useRecordingState();
  const { selectedDevices, setSelectedDevices } = useConfig();
  // El segundo arg (setIsRecording) es no-op porque RecordingStateContext es
  // la fuente de verdad; el tercer arg (showModal) tampoco aplica aquí —
  // si hace falta abrir un modal (config faltante), `useRecordingStart` lo
  // maneja internamente con toast.
  const { handleRecordingStart } = useRecordingStart(
    isRecording,
    () => { /* no-op */ },
    undefined,
  );

  useEffect(() => {
    const unlistenP = listen<WidgetStartPayload | null>(
      'widget-request-start-recording',
      (e) => {
        // Guard: si ya estamos grabando, ignorar el evento. El comando Rust
        // también valida (vía IS_RECORDING flag) pero defendemos en frontend
        // para evitar invocar handleRecordingStart con state inconsistente.
        if (isRecording) return;

        // Iter 6: aplicar devices custom del payload (si vienen) ANTES de
        // que useRecordingStart lea selectedDevices. setSelectedDevices es
        // sync (useState) — el handleRecordingStart en el mismo tick verá
        // el valor viejo, pero handleRecordingStart lee del ConfigContext
        // que se actualiza para el siguiente paint. Si el patrón causa race
        // en alguna prueba, pasar devices como parámetro al hook (V7).
        const payload = e.payload;
        if (payload && (payload.micDevice || payload.sysDevice)) {
          setSelectedDevices({
            micDevice: payload.micDevice ?? selectedDevices.micDevice,
            systemDevice: payload.sysDevice ?? selectedDevices.systemDevice,
          });
        }

        handleRecordingStart();
      },
    );
    return () => { unlistenP.then(fn => fn()); };
  }, [handleRecordingStart, isRecording, selectedDevices, setSelectedDevices]);

  return null;
}
