/**
 * useTranscriptRecovery Hook
 *
 * Orchestrates transcript recovery operations for interrupted meetings.
 * Provides functionality to detect, preview, and recover meetings from IndexedDB.
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { indexedDBService, MeetingMetadata, StoredTranscript } from '@/services/indexedDBService';
import { storageService } from '@/services/storageService';
import { logger } from '@/lib/logger';

interface AudioRecoveryStatus {
  status: string; // "success" | "partial" | "failed" | "none"
  chunk_count: number;
  estimated_duration_seconds: number;
  audio_file_path?: string;
  message: string;
}

export interface RecoveredMeetingSummary {
  /** id del registro IndexedDB (origen) */
  meetingId: string;
  /** id de la reunión ya guardada en SQLite (destino) */
  savedMeetingId: string;
  title: string;
}

export interface AutoRecoverResult {
  recovered: RecoveredMeetingSummary[];
  /** Candidatas que fallaron y quedan en `recoverableMeetings` para el diálogo. */
  failed: MeetingMetadata[];
}

export interface UseTranscriptRecoveryReturn {
  recoverableMeetings: MeetingMetadata[];
  isLoading: boolean;
  isRecovering: boolean;
  /** Devuelve las candidatas encontradas (además de dejarlas en `recoverableMeetings`). */
  checkForRecoverableTranscripts: () => Promise<MeetingMetadata[]>;
  recoverMeeting: (meetingId: string) => Promise<{ success: boolean; audioRecoveryStatus?: AudioRecoveryStatus | null; meetingId?: string }>;
  /** Recupera en serie todas las candidatas (o las que se pasen). */
  autoRecoverAll: (candidates?: MeetingMetadata[]) => Promise<AutoRecoverResult>;
  loadMeetingTranscripts: (meetingId: string) => Promise<StoredTranscript[]>;
  deleteRecoverableMeeting: (meetingId: string) => Promise<void>;
}

/**
 * `api_save_transcript` rechaza guardar sin usuario logueado en el AppState de
 * Rust (`set_current_user` es un IPC que AuthContext dispara al cargar
 * `maityUser`; puede llegar después del arranque de la página). Un fallo así es
 * transitorio: la reunión debe quedar SIN marcar para reintentar en el
 * siguiente arranque, no ir al diálogo como "fallida".
 */
export function isTransientNoUserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no user logged in/i.test(message);
}

export function useTranscriptRecovery(): UseTranscriptRecoveryReturn {
  const [recoverableMeetings, setRecoverableMeetings] = useState<MeetingMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  /**
   * Check for recoverable meetings in IndexedDB
   */
  const checkForRecoverableTranscripts = useCallback(async (): Promise<MeetingMetadata[]> => {
    setIsLoading(true);
    try {
      const meetings = await indexedDBService.getAllMeetings();

      // Exclude the recording that is running RIGHT NOW from the "recoverable" list.
      // A scheduled (or tray/manual) recording in progress isn't saved to SQLite yet and,
      // during silence, its lastUpdated can exceed the 15s threshold below — so without this
      // it would wrongly appear as an "interrupted meeting". Both folderPath values come from
      // the same Rust command (get_meeting_folder_path), so the comparison is exact.
      let activeFolderPath: string | null = null;
      try {
        if (await invoke<boolean>('is_recording')) {
          activeFolderPath = await invoke<string | null>('get_meeting_folder_path');
        }
      } catch (error) {
        console.warn('[recovery] could not check active recording:', error);
      }

      // Filter out meetings older than 7 days and newer than 15 seconds
      // The 15 seconds threshold prevents showing meetings from the current session(jus in case)
      // where recording just stopped but hasn't been fully saved yet
      const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const secondsAgo = Date.now() - (15 * 1000);

      const unsavedMeetings = meetings.filter(m => {
        if (m.savedToSQLite) return false; // Already recovered — skip
        // Skip the currently-active recording (scheduled/tray/manual) — it's not "interrupted".
        if (activeFolderPath && m.folderPath === activeFolderPath) return false;
        const isWithinRetention = m.lastUpdated > cutoffTime; // Not older than 7 days
        const isOldEnough = m.lastUpdated < secondsAgo; // Older than 15 seconds
        return isWithinRetention && isOldEnough;
      });

      // Fantasmas (ago-2026): el registro IndexedDB se crea al ARRANCAR cada
      // grabación con transcriptCount=0 (TranscriptContext, `recording-started`),
      // así que una grabación abortada a los 5 s, un segmento de jornada en
      // silencio (finalize_segment_native devuelve None → nunca se marca guardado)
      // o una grabación cuyo STT nunca cargó dejan entradas que el diálogo ofrecía
      // como "recuperables" — y `recoverMeeting` las rechaza con 'No transcripts
      // found'. Decisión de producto: sin transcripts NO hay nada que recuperar
      // como reunión, incluso si hay checkpoints de audio. Se borra SOLO el
      // registro IndexedDB; los archivos en disco (carpeta, .checkpoints/) no se
      // tocan jamás desde aquí.
      const ghosts = unsavedMeetings.filter(m => m.transcriptCount === 0);
      const recentMeetings = unsavedMeetings.filter(m => m.transcriptCount > 0);
      if (ghosts.length > 0) {
        logger.debug(`[recovery] descartando ${ghosts.length} registro(s) sin transcripts`);
        await Promise.all(
          ghosts.map(g =>
            indexedDBService.deleteMeeting(g.meetingId).catch(error => {
              console.warn('[recovery] no se pudo borrar registro fantasma:', g.meetingId, error);
            })
          )
        );
      }

      // Verify audio checkpoint availability for each meeting
      const meetingsWithAudioStatus = await Promise.all(
        recentMeetings.map(async (meeting) => {
          if (meeting.folderPath) {
            try {
              const hasAudio = await invoke<boolean>('has_audio_checkpoints', {
                meetingFolder: meeting.folderPath
              });

              // If no audio files, clear folderPath to show "No audio" in UI
              return {
                ...meeting,
                folderPath: hasAudio ? meeting.folderPath : undefined
              };
            } catch (error) {
              console.warn('Failed to check audio for meeting:', error);
              // On error, assume no audio to be safe
              return { ...meeting, folderPath: undefined };
            }
          }
          return meeting;
        })
      );


      setRecoverableMeetings(meetingsWithAudioStatus);
      return meetingsWithAudioStatus;
    } catch (error) {
      console.error('Failed to check for recoverable transcripts:', error);
      setRecoverableMeetings([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Load transcripts for preview
   */
  const loadMeetingTranscripts = useCallback(async (meetingId: string): Promise<StoredTranscript[]> => {
    try {
      const transcripts = await indexedDBService.getTranscripts(meetingId);
      // Sort by sequence ID
      transcripts.sort((a, b) => (a.sequenceId || 0) - (b.sequenceId || 0));
      return transcripts;
    } catch (error) {
      console.error('Failed to load meeting transcripts:', error);
      return [];
    }
  }, []);

  /**
   * Recover a meeting from IndexedDB
   */
  const recoverMeeting = useCallback(async (meetingId: string): Promise<{ success: boolean; audioRecoveryStatus?: AudioRecoveryStatus | null; meetingId?: string }> => {
    setIsRecovering(true);
    try {
      // 1. Load meeting metadata
      const metadata = await indexedDBService.getMeetingMetadata(meetingId);
      if (!metadata) {
        throw new Error('Meeting metadata not found');
      }

      // 2. Load all transcripts
      const transcripts = await loadMeetingTranscripts(meetingId);
      if (transcripts.length === 0) {
        throw new Error('No transcripts found for this meeting');
      }

      // 3. Check for folder path
      let folderPath = metadata.folderPath;


      if (!folderPath) {
        // Try to get from backend (might exist if only app crashed, not system)
        try {
          folderPath = await invoke<string>('get_meeting_folder_path');
        } catch {
          folderPath = undefined;
        }
      }

      // 4. Attempt audio recovery if folder path exists
      let audioRecoveryStatus: AudioRecoveryStatus | null = null;
      if (folderPath) {
        try {
          audioRecoveryStatus = await invoke<AudioRecoveryStatus>(
            'recover_audio_from_checkpoints',
            { meetingFolder: folderPath, sampleRate: 48000 }
          );
        } catch (error) {
          console.error('Audio recovery failed:', error);
          audioRecoveryStatus = {
            status: 'failed',
            chunk_count: 0,
            estimated_duration_seconds: 0,
            message: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      } else {
        audioRecoveryStatus = {
          status: 'none',
          chunk_count: 0,
          estimated_duration_seconds: 0,
          message: 'No folder path available'
        };
      }

      // 5. Convert StoredTranscripts to the format expected by storageService
      const formattedTranscripts = transcripts.map((t, index) => ({
        id: t.id?.toString() || `${Date.now()}-${index}`,
        text: t.text,
        timestamp: t.timestamp,
        sequence_id: t.sequenceId || index,
        chunk_start_time: t.chunk_start_time as number | undefined,
        is_partial: (t.is_partial as boolean | undefined) || false,
        confidence: t.confidence,
        audio_start_time: t.audio_start_time,
        audio_end_time: t.audio_end_time,
        duration: t.duration,
      }));

      // 6. Save to backend database using existing save utilities
      const saveResponse = await storageService.saveMeeting(
        metadata.title,
        formattedTranscripts,
        folderPath ?? null
      );

      const savedMeetingId = saveResponse.meeting_id;

      // 7. Mark as saved in IndexedDB
      await indexedDBService.markMeetingSaved(meetingId);


      // 8. Clean up checkpoint files
      if (folderPath) {
        try {
          await invoke('cleanup_checkpoints', { meetingFolder: folderPath });
        } catch (error) {
          // Non-fatal - don't fail recovery if cleanup fails
          console.warn('Checkpoint cleanup failed (non-fatal):', error);
        }
      }

      // 9. Remove from recoverable list
      setRecoverableMeetings(prev => prev.filter(m => m.meetingId !== meetingId));

      return {
        success: true,
        audioRecoveryStatus,
        meetingId: savedMeetingId
      };
    } catch (error) {
      console.error('Failed to recover meeting:', error);
      throw error;
    } finally {
      setIsRecovering(false);
    }
  }, [loadMeetingTranscripts]);

  /**
   * Recuperación AUTOMÁTICA (ago-2026): en vez de pedirle al usuario que abra el
   * diálogo, seleccione y pulse "Recuperar", se recorren en serie todas las
   * candidatas (ya filtradas: con transcripts) y se guardan solas. Las que fallan
   * quedan en `recoverableMeetings` — el diálogo pasa a ser solo red de seguridad.
   *
   * En serie y no en paralelo a propósito: cada `recoverMeeting` lanza FFmpeg
   * (merge de checkpoints) y escribe en SQLite; N en paralelo al arranque
   * competirían por disco/CPU justo cuando la app está cargando modelos.
   */
  const autoRecoverAll = useCallback(async (candidates?: MeetingMetadata[]): Promise<AutoRecoverResult> => {
    const list = candidates ?? recoverableMeetings;
    const recovered: RecoveredMeetingSummary[] = [];
    const failed: MeetingMetadata[] = [];

    for (const meeting of list) {
      try {
        const result = await recoverMeeting(meeting.meetingId);
        if (result.success && result.meetingId) {
          recovered.push({ meetingId: meeting.meetingId, savedMeetingId: result.meetingId, title: meeting.title });
        } else {
          failed.push(meeting);
        }
      } catch (error) {
        if (isTransientNoUserError(error)) {
          // Reintento en el próximo arranque; se saca de la lista para no abrir el diálogo.
          logger.warn('[recovery] sin usuario en Rust todavía; se pospone', meeting.meetingId);
          setRecoverableMeetings(prev => prev.filter(m => m.meetingId !== meeting.meetingId));
        } else {
          console.error('[recovery] auto-recuperación fallida:', meeting.meetingId, error);
          failed.push(meeting);
        }
      }
    }

    return { recovered, failed };
  }, [recoverableMeetings, recoverMeeting]);

  /**
   * Delete a recoverable meeting
   */
  const deleteRecoverableMeeting = useCallback(async (meetingId: string): Promise<void> => {
    try {
      await indexedDBService.deleteMeeting(meetingId);
      setRecoverableMeetings(prev => prev.filter(m => m.meetingId !== meetingId));
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      throw error;
    }
  }, []);

  return {
    recoverableMeetings,
    isLoading,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    autoRecoverAll,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  };
}
