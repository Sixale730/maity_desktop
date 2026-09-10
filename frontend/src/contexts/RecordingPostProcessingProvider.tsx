'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { logger } from '@/lib/logger';
import { TauriEvent, type BatchTranscriptionStatusPayload } from '@/lib/tauri-events';
import { sendNativeNotification } from '@/lib/nativeNotification';
// Nombre del evento DOM (CustomEvent, NO Tauri) al que se reenvía
// `batch-transcription-status`. Mismo patrón que `sync-status-changed`: quien
// quiera reaccionar (el bloque "Transcripciones pendientes") escucha el bus DOM
// y no vuelve a suscribirse al evento nativo. Vive en el service (módulo ligero)
// para que sus consumidores no arrastren este provider a sus tests.
import { BATCH_STATUS_DOM_EVENT } from '@/features/conversations/services/batchQueue.service';

/**
 * Payload de un rotate/close del scheduler.
 *
 * `batch: true` significa "ESTA sesión grabó en lote" — el modo SELLADO al
 * arrancar el segmento (`RecordingState::transcription_mode`), NO la
 * preferencia viva del usuario: si cambia el modo a mitad de jornada, el
 * segmento en curso conserva el suyo. Con ese flag el registro IndexedDB no
 * tiene transcripts por construcción y la cola de Rust
 * (`batch_transcription_queue`) es la dueña del guardado; marcarlo evita que
 * `autoRecoverAll` lo ofrezca como "grabación por recuperar".
 */
interface SegmentClosedPayload {
  meetingId: string | null;
  meetingName: string;
  discarded?: boolean;
  batch?: boolean;
}

/**
 * ¿Estamos en la LISTA de conversaciones (sin un detalle abierto)? Se lee del
 * `window.location` en el momento del evento, no de hooks: el provider vive en
 * el root layout y `useSearchParams` ahí exigiría un Suspense boundary en el
 * export estático; además así el efecto no depende de la ruta y se monta una vez.
 */
function isOnConversationsListView(): boolean {
  try {
    const { pathname, search } = window.location;
    if (pathname !== '/conversations') return false;
    const params = new URLSearchParams(search);
    return !params.get('localId') && !params.get('id');
  } catch {
    return false;
  }
}

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
  const { clearTranscripts, markMeetingAsSaved } = useTranscripts();

  const router = useRouter();

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

  // Ref estable a markMeetingAsSaved: al rotar/cerrar jornada, Rust YA guardó el segmento
  // a SQLite (meetingId non-null) — marcarlo en IndexedDB evita que aparezca como
  // "grabación por recuperar" falsa en el próximo arranque.
  const markMeetingAsSavedRef = useRef(markMeetingAsSaved);
  useEffect(() => {
    markMeetingAsSavedRef.current = markMeetingAsSaved;
  });

  // Ref estable al router: el listener del lote navega, pero no debe
  // resuscribirse cuando cambie la identidad del router (#65).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    const subs = createSubscriptionGroup();

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        subs.on<boolean>(TauriEvent.RECORDING_STOP_COMPLETE, (event) => {
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
      logger.debug('[RecordingPostProcessing] Cleaning up event listener');
      subs.dispose();
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
    const subs = createSubscriptionGroup();

    const setupRotateListener = async () => {
      try {
        subs.on<SegmentClosedPayload>(
          TauriEvent.SCHEDULED_SEGMENT_ROTATED,
          async (event) => {
            logger.debug('[RecordingPostProcessing] Segmento rotado, reseteando buffer:', event.payload);
            // meetingId null = finalize falló en Rust → NO marcar: el diálogo de
            // recovery queda como red de seguridad para ese segmento.
            //
            // `discarded` es lo contrario: Rust decidió tirar el segmento por no llegar al
            // umbral de contenido (#4 del piloto Dingler). Ahí SÍ hay que marcarlo, o
            // `autoRecoverAll` lo guardaría solo en el próximo arranque — el filtro de fantasmas
            // sólo borra los de `transcriptCount === 0`, y este tiene transcripts, sólo que pocos.
            //
            // `batch` (F3/F4): el segmento se cerró en modo lote (modo SELLADO de
            // la sesión, ver `SegmentClosedPayload`) — meetingId null a propósito
            // (la reunión nace cuando el planner termina). El registro IndexedDB
            // no tiene transcripts y la cola de Rust es la dueña: marcarlo.
            if (event.payload.meetingId || event.payload.discarded || event.payload.batch) {
              await markMeetingAsSavedRef.current();
            }
            clearTranscriptsRef.current();
            // El espejo del modo (`useRecordingStop` lo escribe en cada
            // `recording-stopped`) describe al segmento que acaba de cerrar, no
            // al que arranca: fuera, como en JORNADA_CLOSED. La decisión
            // lote/streaming del stop ya no lo lee (va por el evento de la
            // sesión), pero un valor rancio visible confunde el diagnóstico.
            sessionStorage.removeItem('last_recording_transcription_mode');
          }
        );
        subs.on<SegmentClosedPayload>(
          TauriEvent.SCHEDULED_JORNADA_CLOSED,
          async (event) => {
            logger.debug('[RecordingPostProcessing] Jornada cerrada headless, reseteando buffer:', event.payload);
            if (event.payload.meetingId || event.payload.discarded || event.payload.batch) {
              await markMeetingAsSavedRef.current();
            }
            clearTranscriptsRef.current();
            // Higiene: el `recording-stopped` del stop nativo pobló estas keys; limpiarlas
            // evita que un futuro stop manual herede metadata (folder/nombre/duración) de
            // la jornada ya guardada por Rust.
            sessionStorage.removeItem('last_recording_folder_path');
            sessionStorage.removeItem('last_recording_meeting_name');
            sessionStorage.removeItem('last_recording_duration_seconds');
            sessionStorage.removeItem('last_recording_started_at');
            // El modo también es de ESA sesión: una key `batch` rancia saltaría el
            // guardado del siguiente stop manual en streaming.
            sessionStorage.removeItem('last_recording_transcription_mode');
          }
        );
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up rotation listener:', error);
      }
    };

    setupRotateListener();

    return () => subs.dispose();
  }, []); // Solo se monta una vez

  // Transcripción por lote (F4): `batch-transcription-status` es el único canal
  // por el que el frontend se entera de que un segmento en lote terminó.
  //   - SIEMPRE se reenvía al bus DOM (`BATCH_STATUS_DOM_EVENT`): el bloque de
  //     pendientes y la lista de conversaciones invalidan sus queries por ahí.
  //   - `failed` → toast con "Abrir carpeta" (el audio sigue en disco; el
  //     reintento vive en el bloque de pendientes).
  //   - `ready` + meetingId: si fue un stop MANUAL, se pide feedback como en
  //     streaming y, si el usuario sigue esperando en la lista de Conversaciones
  //     (ancla `batch_pending_navigation` = la carpeta que acaba de parar), se
  //     abre el detalle; si se fue a otra parte, toast "Ver" + notificación nativa.
  //     Los segmentos de jornada son silenciosos: la lista se refresca sola.
  useEffect(() => {
    const subs = createSubscriptionGroup();

    const setupBatchListener = async () => {
      try {
        subs.on<BatchTranscriptionStatusPayload>(
          TauriEvent.BATCH_TRANSCRIPTION_STATUS,
          (event) => {
            const payload = event.payload;
            logger.debug('[RecordingPostProcessing] batch-transcription-status:', payload);

            try {
              window.dispatchEvent(new CustomEvent(BATCH_STATUS_DOM_EVENT, { detail: payload }));
            } catch (error) {
              console.warn('[RecordingPostProcessing] no se pudo reenviar al bus DOM:', error);
            }

            if (payload.status === 'failed') {
              toast.error('No se pudo transcribir la grabación', {
                description: 'El audio quedó en su carpeta. Puedes reintentar desde Conversaciones.',
                duration: 10000,
                action: {
                  label: 'Abrir carpeta',
                  onClick: () => {
                    invoke('reveal_in_folder', { path: payload.folderPath }).catch(() => {});
                  },
                },
              });
              return;
            }

            if (payload.status !== 'ready' || !payload.meetingId) return;
            if (payload.trigger !== 'manual') return; // jornada: silencioso

            const meetingId = payload.meetingId;
            const detailUrl = `/conversations?localId=${meetingId}&source=recording`;

            // Igual que el stop en streaming: el modal de feedback lo pide
            // ConversationDetail al montar leyendo esta key.
            sessionStorage.setItem('feedback_pending_meeting_id', meetingId);

            const pendingFolder = sessionStorage.getItem('batch_pending_navigation');
            if (pendingFolder === payload.folderPath) {
              sessionStorage.removeItem('batch_pending_navigation');
              if (isOnConversationsListView()) {
                routerRef.current.push(detailUrl);
                return;
              }
            }

            toast.success('Transcripción lista', {
              description: 'Tu reunión ya está en Conversaciones.',
              duration: 8000,
              action: {
                label: 'Ver',
                onClick: () => routerRef.current.push(detailUrl),
              },
            });
            void sendNativeNotification({
              title: 'Transcripción lista',
              body: 'Tu reunión ya está en Conversaciones. Click para revisarla.',
              actionTypeId: 'open-main-window',
            });
          }
        );
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up batch listener:', error);
      }
    };

    setupBatchListener();

    return () => subs.dispose();
  }, []); // Solo se monta una vez

  return <>{children}</>;
}
