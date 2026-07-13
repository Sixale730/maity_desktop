'use client';

import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { logger } from '@/lib/logger';
import { TauriEvent } from '@/lib/tauri-events';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate, analytics)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  // No-op function since the global RecordingStateContext already handles state updates
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecordingDisabled);

  // Reset del buffer de transcripción en cada rotación por hora (Incremento 4).
  const { clearTranscripts } = useTranscripts();

  // Mantener ref estable al callback para evitar re-subscripciones innecesarias
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  // Ref estable a clearTranscripts para el listener de rotación (sin re-subscribir).
  const clearTranscriptsRef = useRef(clearTranscripts);
  useEffect(() => {
    clearTranscriptsRef.current = clearTranscripts;
  });

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>(TauriEvent.RECORDING_STOP_COMPLETE, (event) => {
          logger.debug('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);

          // Call the post-processing handler via ref (estable)
          // event.payload is the callApi boolean (true for normal stops)
          handleRecordingStopRef.current(event.payload);
        });

        logger.debug('[RecordingPostProcessing] Event listener set up successfully');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        logger.debug('[RecordingPostProcessing] Cleaning up event listener');
        unlistenFn();
      }
    };
  }, []); // Sin dependencias - solo se ejecuta una vez al montar

  // Rotación por hora (Incremento 4) y cierre headless de jornada (gap #54): en ambos, Rust
  // ya guardó el segmento cerrado en local Y encoló sus 3 jobs de sync cloud (Transactional
  // Outbox — ver `scheduled_recording/service.rs::finalize_segment_native`). Aquí SOLO
  // reseteamos el buffer de transcripción — SIN navegar, SIN llamar a enqueueCloudSync — para
  // que (a) la UI del nuevo segmento arranque limpia y (b) un stop manual posterior NO
  // re-guarde los segmentos acumulados como una reunión duplicada. Encolar aquí también
  // crearía jobs duplicados apuntando al mismo meeting_id.
  useEffect(() => {
    let unlistenRotate: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    const setupRotateListener = async () => {
      try {
        unlistenRotate = await listen<{ meetingId: string | null; meetingName: string }>(
          TauriEvent.SCHEDULED_SEGMENT_ROTATED,
          (event) => {
            logger.debug('[RecordingPostProcessing] Segmento rotado, reseteando buffer:', event.payload);
            clearTranscriptsRef.current();
          }
        );
        unlistenClosed = await listen<{ meetingId: string | null; meetingName: string }>(
          TauriEvent.SCHEDULED_JORNADA_CLOSED,
          (event) => {
            logger.debug('[RecordingPostProcessing] Jornada cerrada headless, reseteando buffer:', event.payload);
            clearTranscriptsRef.current();
            // Higiene: el `recording-stopped` del stop nativo pobló estas keys; limpiarlas
            // evita que un futuro stop manual herede metadata (folder/nombre/duración) de
            // la jornada ya guardada por Rust.
            sessionStorage.removeItem('last_recording_folder_path');
            sessionStorage.removeItem('last_recording_meeting_name');
            sessionStorage.removeItem('last_recording_duration_seconds');
          }
        );
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up rotation listener:', error);
      }
    };

    setupRotateListener();

    return () => {
      if (unlistenRotate) {
        unlistenRotate();
      }
      if (unlistenClosed) {
        unlistenClosed();
      }
    };
  }, []); // Solo se monta una vez

  return <>{children}</>;
}
