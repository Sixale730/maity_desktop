import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import { recordingLogService } from '@/services/recordingLogService';
import Analytics from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { invoke } from '@tauri-apps/api/core';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { logPoll } from '@/lib/diagnostics';
import type { Transcript } from '@/types';

type SummaryStatus = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

/**
 * Custom hook for managing recording stop lifecycle.
 * Local-first flow: Stop -> flush buffer (max 5s) -> save SQLite -> navigate -> enqueue cloud sync (fire-and-forget).
 * El feedback modal se muestra desde ConversationDetail leyendo
 * sessionStorage 'feedback_pending_meeting_id', sin bloquear la navegacion.
 */
export function useRecordingStop(
  setIsRecordingDisabled: (value: boolean) => void
): UseRecordingStopReturn {
  // Auth and config for Supabase save
  const { maityUser } = useAuth();
  const { transcriptModelConfig } = useConfig();

  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript
  } = recordingState;

  const {
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setIsMeetingActive,
  } = useSidebar();

  const router = useRouter();

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray simultaneously)
  const stopInProgressRef = useRef(false);

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        logger.debug('Setting up recording-stopped listener for navigation...');
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
          duration_seconds?: number | null;
        }>('recording-stopped', async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name, duration_seconds } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
            // Wall-clock duration capturada por Rust ANTES del teardown del manager.
            // Inmune al bug 2x de timestamps VAD/Deepgram cuando hay sample rate mismatch.
            if (typeof duration_seconds === 'number' && duration_seconds > 0) {
              sessionStorage.setItem('last_recording_duration_seconds', String(duration_seconds));
            }
          })();

        });
        logger.debug('Recording stopped listener setup complete');
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      logger.debug('Cleaning up recording stopped listener...');
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler — LOCAL-FIRST flow
  const handleRecordingStop = useCallback(async (isCallApi: boolean) => {
    // Guard: prevent duplicate/concurrent stop calls (BEFORE any await)
    if (stopInProgressRef.current) {
      return;
    }
    stopInProgressRef.current = true;

    // Set status to STOPPING immediately
    setStatus(RecordingStatus.STOPPING);
    setIsRecordingDisabled(true);
    const stopStartTime = Date.now();

    // Log recording stopped
    recordingLogService.log('recording_stopped', {
      transcript_count: transcriptsRef.current.length,
    }, 'success');

    let wallClockDuration: number | null = null;

    try {
      // Wait for recording-stopped event data if it arrived
      if (recordingStoppedDataRef.current) {
        await recordingStoppedDataRef.current;
      }

      // Leer wall-clock duration de sessionStorage (poblada por el listener de
      // 'recording-stopped'). Rust la captura en recording_lifecycle.rs ANTES
      // de tomar/dropear el RECORDING_MANAGER, asi que refleja el Instant::elapsed
      // real, inmune al bug 2x de timestamps VAD por sample rate mismatch.
      const durationStr = sessionStorage.getItem('last_recording_duration_seconds');
      if (durationStr) {
        const parsed = Number(durationStr);
        if (Number.isFinite(parsed) && parsed > 0) {
          wallClockDuration = parsed;
          logger.debug('[RecordingStop] Wall-clock duration from event:', wallClockDuration);
        }
      }
      // Fallback: React state (puede estar nulificada por el listener, pero
      // si el evento aun no llego es lo mejor que tenemos).
      if (wallClockDuration === null && recordingState.activeDuration) {
        wallClockDuration = recordingState.activeDuration;
        logger.debug('[RecordingStop] Wall-clock duration from React state fallback:', wallClockDuration);
      }

      logger.debug('Post-stop processing (local-first)...', {
        stop_initiated_at: new Date(stopStartTime).toISOString(),
        current_transcript_count: transcriptsRef.current.length
      });

      // Note: stop_recording is already called by RecordingControls.stopRecordingAction
      // This function only handles post-stop processing

      // Flush buffer with max 5s timeout — Parakeet already processed in real-time
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Flushing transcript buffer...');
      logger.debug('Flushing transcript buffer...');

      flushBuffer();

      // Brief wait for React state to settle (500ms max)
      await new Promise(resolve => setTimeout(resolve, 500));

      logger.debug('Buffer flush completed', {
        total_time_since_stop: Date.now() - stopStartTime,
        final_transcript_count: transcriptsRef.current.length
      });
      recordingLogService.log('buffer_flush_completed', {
        flush_duration_ms: Date.now() - stopStartTime,
        final_transcript_count: transcriptsRef.current.length,
      }, 'success');

      // Save to SQLite
      if (isCallApi && transcriptsRef.current.length > 0) {

        setStatus(RecordingStatus.SAVING, 'Saving meeting to database...');
        recordingLogService.log('sqlite_save_attempted', {
          transcript_count: transcriptsRef.current.length,
        }, 'success');

        // Get fresh transcript state (ALL transcripts including late ones)
        const freshTranscripts = [...transcriptsRef.current];

        // Get folder_path and meeting_name from recording-stopped event
        const folderPath = sessionStorage.getItem('last_recording_folder_path');
        const savedMeetingName = sessionStorage.getItem('last_recording_meeting_name');
        const earlyMeetingId = sessionStorage.getItem('early_meeting_id');

        logger.debug('Saving transcripts to database...', {
          transcript_count: freshTranscripts.length,
          meeting_name: savedMeetingName || meetingTitle,
          folder_path: folderPath,
          early_meeting_id: earlyMeetingId,
        });

        try {
          const responseData = await storageService.saveMeeting(
            savedMeetingName || meetingTitle || 'New Meeting',
            freshTranscripts,
            folderPath,
            earlyMeetingId
          );

          const meetingId = responseData.meeting_id;
          if (!meetingId) {
            console.error('No meeting_id in response:', responseData);
            throw new Error('No meeting ID received from save operation');
          }

          logger.debug('Successfully saved meeting with ID:', meetingId);
          recordingLogService.setMeetingId(meetingId);
          recordingLogService.log('sqlite_save_succeeded', {
            meeting_id: meetingId,
            transcript_count: freshTranscripts.length,
          }, 'success');

          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          sessionStorage.removeItem('last_recording_duration_seconds');
          sessionStorage.removeItem('early_meeting_id');
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Marcar que esta sesion debe pedir feedback. ConversationDetail lee
          // este flag al montarse y muestra el modal sobre la evaluacion. La
          // navegacion no espera al feedback — la evaluacion arranca de
          // inmediato.
          sessionStorage.setItem('feedback_pending_meeting_id', meetingId);

          // Persistir el toast para que la pagina destino lo muestre tras el
          // hard reload (sessionStorage sobrevive a window.location.href).
          sessionStorage.setItem('post_recording_toast', JSON.stringify({
            count: freshTranscripts.length,
            ts: Date.now(),
          }));

          // CRITICO: enqueueCloudSync debe completar ANTES del hard navigate.
          // Con router.push (soft) las lineas siguientes corren porque Next.js
          // mantiene el JS context vivo. Con window.location.href (hard) el
          // browser descarga el JS inmediatamente: si los invoke() a Rust no
          // han terminado, los jobs nunca llegan al sync_queue y la conversacion
          // queda solo local. await garantiza que las 3 jobs esten enqueued.
          await enqueueCloudSync(freshTranscripts, meetingId, savedMeetingName, wallClockDuration);

          // Native OS notification (fire-and-forget; el OS la maneja, sobrevive al unload).
          // Si la main window estaba minimizada al hacer stop, el flag global
          // KEEP_MAIN_MINIMIZED_AFTER_STOP la mantiene minimizada tras el hard navigate.
          // La notif accionable permite al usuario decidir si quiere revisar la reunión
          // ahora (click "Abrir Maity" → unminimize_and_focus_main) o más tarde (la
          // ventana queda minimizada y el modal feedback espera).
          import('@/lib/nativeNotification').then(({ sendNativeNotification }) =>
            sendNativeNotification({
              title: 'Grabación lista',
              body: `${freshTranscripts.length} segmentos guardados. Click para revisar tu reunión.`,
              actionTypeId: 'open-main-window',
            })
          ).catch(() => {});

          // Analytics fire-and-forget (no bloquea; puede no completar si el unload corta)
          trackMeetingAnalytics(freshTranscripts, meetingId, wallClockDuration).catch(e =>
            console.error('Failed to track meeting analytics:', e)
          );
          Analytics.trackPageView('conversations');

          logPoll('post_stop_hard_navigate', {
            meetingId,
            transcriptCount: freshTranscripts.length,
          });
          logger.debug(`[RecordingStop] Hard navigate to /conversations?localId=${meetingId}`);

          // Hard navigate — patron "supervised restart" (Slack/VS Code/Erlang OTP).
          // Mata el JS context, resetea el cliente Supabase, TanStack Query, Realtime
          // channels y cualquier estado envenenado tras grabacion larga + LLM coach +
          // sidecar. Es el equivalente automatico al "cerrar+abrir" que el usuario
          // hacia manual cuando el dashboard se colgaba post-stop.
          //
          // Las llamadas refetchMeetings(), setCurrentMeeting(), clearTranscripts() y
          // setStatus(IDLE) NO se hacen aqui porque el reload las hace innecesarias:
          // la pagina destino reconstruye estado al montar.
          window.location.href = `/conversations?localId=${meetingId}&source=recording`;

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          recordingLogService.log('sqlite_save_failed', null, 'error', saveError instanceof Error ? saveError.message : String(saveError));
          setStatus(RecordingStatus.ERROR, saveError instanceof Error ? saveError.message : 'Unknown error');
          toast.error('Error al guardar reunion', {
            description: saveError instanceof Error ? saveError.message : 'Error desconocido'
          });
          throw saveError;
        }
      } else {
        // No save needed — CRITICAL: log why
        if (isCallApi && transcriptsRef.current.length === 0) {
          recordingLogService.log('save_skipped_no_transcripts', {
            is_call_api: isCallApi,
            transcript_count: 0,
          }, 'skipped');

          // Clean up sessionStorage (no ghost to delete — meeting was never inserted)
          sessionStorage.removeItem('early_meeting_id');
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
        }

        // Mark IndexedDB meeting as saved when there's nothing useful to recover.
        // Without this, empty/cancelled sessions stay flagged savedToSQLite=false
        // and the recovery dialog appears on the next cold start with nothing to
        // offer the user.
        if (transcriptsRef.current.length === 0) {
          await markMeetingAsSaved();
        }
        setStatus(RecordingStatus.IDLE);
      }

      setIsMeetingActive(false);
      setIsRecordingDisabled(false);

      // Sync recording logs to cloud (fire-and-forget)
      recordingLogService.syncToCloud();
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
      setIsRecordingDisabled(false);
    } finally {
      // Always reset the guard flag when done
      stopInProgressRef.current = false;
    }
  }, [
    setIsRecordingDisabled,
    setStatus,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    setIsMeetingActive,
    router,
    maityUser,
    transcriptModelConfig,
  ]);

  // Fire-and-forget cloud sync enqueue
  const enqueueCloudSync = useCallback(async (
    freshTranscripts: Transcript[],
    meetingId: string,
    savedMeetingName: string | null,
    wallClockDurationSec: number | null,
  ) => {
    // Resolve effective user for cloud save (fallback if maityUser is null due to race)
    let effectiveMaityUser = maityUser;
    if (!effectiveMaityUser?.id && freshTranscripts.length > 0) {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user) {
          const { data: userData } = await supabase
            .from('users')
            .select('id, auth_id, first_name, last_name, email, status, created_at, updated_at')
            .eq('auth_id', currentSession.user.id)
            .single();
          if (userData) effectiveMaityUser = userData;
        }
      } catch (e) {
        console.warn('[RecordingStop] Fallback user fetch failed:', e);
      }
    }

    if (!effectiveMaityUser?.id || freshTranscripts.length === 0) return;

    try {
      // Sort chronologically: dual-channel (mic + system) chunks arrive out of order in
      // transcriptsRef. Sorting here guarantees transcript_text reads naturally and that
      // duration/started_at are computed off the real first/last samples.
      const sortedTranscripts = [...freshTranscripts].sort(
        (a, b) => (a.audio_start_time ?? 0) - (b.audio_start_time ?? 0)
      );

      const transcriptText = sortedTranscripts.map(t => {
        const speaker = t.source_type === 'user' ? 'Usuario' : 'Interlocutor';
        return `${speaker}: ${t.text}`;
      }).join('\n');

      // Preferir wall-clock de Rust (Instant::elapsed) sobre max(audio_end_time)
      // porque los timestamps de transcripts pueden estar inflados si el dispositivo
      // reporta mal su sample rate (ver bug 2x-drift en plan keen-snacking-hearth).
      // Fallback a max(audio_end_time) solo si wall-clock no esta disponible.
      const transcriptMaxEnd = sortedTranscripts.length > 0
        ? sortedTranscripts.reduce(
            (max, t) => Math.max(max, t.audio_end_time ?? t.audio_start_time ?? 0),
            0
          )
        : 0;

      const durationSec = wallClockDurationSec && wallClockDurationSec > 0
        ? Math.round(wallClockDurationSec)
        : Math.round(transcriptMaxEnd);

      // Diagnostico: detectar drift entre wall-clock y timestamps de transcripts.
      // Post-Level-2 esto deberia ser ~1.0; si dispara ~2.0, hay sample rate mismatch.
      if (wallClockDurationSec && wallClockDurationSec > 0 && transcriptMaxEnd > 0) {
        const driftRatio = transcriptMaxEnd / wallClockDurationSec;
        if (driftRatio > 1.3 || driftRatio < 0.7) {
          logger.warn('[RecordingStop] Timestamp drift detectado', {
            wall_clock_sec: wallClockDurationSec,
            transcript_max_end_sec: transcriptMaxEnd,
            drift_ratio: driftRatio,
          });
        }
      }

      const wordsCount = sortedTranscripts
        .map(t => t.text.split(/\s+/).length)
        .reduce((a, b) => a + b, 0);

      const now = new Date().toISOString();
      const startedAt = sortedTranscripts[0]?.audio_start_time !== undefined
        ? new Date(Date.now() - (durationSec * 1000)).toISOString()
        : now;

      const segments = sortedTranscripts.map((t, i) => ({
        segment_index: t.sequence_id ?? i,
        text: t.text,
        speaker: t.source_type === 'user' ? 'user' : 'interlocutor',
        speaker_id: t.source_type === 'user' ? 0 : 1,
        is_user: t.source_type === 'user',
        start_time: t.audio_start_time || 0,
        end_time: t.audio_end_time || 0,
      }));

      // Resolve (or create + persist) the cloud idempotency key for this
      // meeting. Reused across job retries so a network failure mid-INSERT
      // does NOT create duplicate rows in maity.omi_conversations (its
      // UNIQUE (idempotency_key) constraint collapses the second attempt
      // and we get the original conversation_id back).
      const idempotencyKey = await invoke<string>(
        'api_get_or_create_meeting_idempotency_key',
        { meetingId },
      );

      // Job 1: save_conversation
      const job1Id = await invoke<number>('sync_queue_enqueue', {
        jobType: 'save_conversation',
        meetingId,
        payload: JSON.stringify({
          user_id: effectiveMaityUser.id,
          title: savedMeetingName || meetingTitle || 'Nueva Reunion',
          started_at: startedAt,
          finished_at: now,
          transcript_text: transcriptText,
          source: 'maity_desktop',
          language: transcriptModelConfig?.language || 'es',
          words_count: wordsCount,
          duration_seconds: durationSec,
          idempotency_key: idempotencyKey,
        }),
      });

      // Job 2: save_transcript_segments (depends on Job 1)
      const job2Id = await invoke<number>('sync_queue_enqueue', {
        jobType: 'save_transcript_segments',
        meetingId,
        payload: JSON.stringify({
          user_id: effectiveMaityUser.id,
          segments,
        }),
        dependsOn: job1Id,
      });

      // Job 3: finalize_conversation (depends on Job 2)
      await invoke<number>('sync_queue_enqueue', {
        jobType: 'finalize_conversation',
        meetingId,
        payload: JSON.stringify({
          duration_seconds: durationSec,
        }),
        dependsOn: job2Id,
      });

      logger.debug(`[RecordingStop] Enqueued 3 cloud sync jobs for meeting ${meetingId}`);
      recordingLogService.log('cloud_sync_enqueued', {
        meeting_id: meetingId,
        job_count: 3,
      }, 'success');

      toast.info('Sincronizando con la nube...', { duration: 3000 });
    } catch (err) {
      // Enqueue failure is non-fatal — local save already succeeded
      console.warn('[RecordingStop] Failed to enqueue cloud sync:', err);
      recordingLogService.log('cloud_sync_enqueue_failed', null, 'error',
        err instanceof Error ? err.message : String(err));
    }
  }, [maityUser, meetingTitle, transcriptModelConfig]);

  // Analytics tracking (fire-and-forget)
  const trackMeetingAnalytics = useCallback(async (
    freshTranscripts: Transcript[],
    meetingId: string,
    wallClockDurationSec: number | null,
  ) => {
    // Preferir wall-clock; fallback a audio_end_time del ultimo transcript.
    let durationSeconds = wallClockDurationSec && wallClockDurationSec > 0
      ? Math.round(wallClockDurationSec)
      : 0;
    if (!durationSeconds && freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
      const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
      durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
    }

    const transcriptWordCount = freshTranscripts
      .map(t => t.text.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);

    const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;
    const meetingsToday = await Analytics.getMeetingsCountToday();

    await Analytics.trackMeetingCompleted(meetingId, {
      duration_seconds: durationSeconds,
      transcript_segments: freshTranscripts.length,
      transcript_word_count: transcriptWordCount,
      words_per_minute: wordsPerMinute,
      meetings_today: meetingsToday
    });

    await Analytics.updateMeetingCount();

    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('analytics.json');
    const totalMeetings = await store.get<number>('total_meetings');

    // Keep user profile properties fresh so PostHog can segment recorders vs non-recorders
    const currentUserId = Analytics.getCurrentUserId();
    if (currentUserId) {
      await Analytics.identify(currentUserId, {
        has_recorded: 'true',
        total_recordings: (totalMeetings ?? 1).toString(),
      });
    }

    if (totalMeetings === 1) {
      const daysSinceInstall = await Analytics.calculateDaysSince('first_launch_date');
      await Analytics.track('user_activated', {
        meetings_count: '1',
        days_since_install: daysSinceInstall?.toString() || 'null',
        first_meeting_duration_seconds: durationSeconds.toString()
      });
    }
  }, []);

  // Expose handleRecordingStop function to window for Rust callbacks
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window API used by Rust callbacks
    (window as any).handleRecordingStop = (callApi: boolean = true) => {
      handleRecordingStopRef.current(callApi);
    };

    // Cleanup on unmount
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window API used by Rust callbacks
      delete (window as any).handleRecordingStop;
    };
  }, []);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus = status === RecordingStatus.PROCESSING_TRANSCRIPTS ? 'processing' : 'idle';

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
