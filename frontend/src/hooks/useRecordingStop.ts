import { useState, useEffect, useCallback, useRef } from 'react';
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
        console.log('Setting up recording-stopped listener for navigation...');
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>('recording-stopped', async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
          })();

        });
        console.log('Recording stopped listener setup complete');
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      console.log('Cleaning up recording stopped listener...');
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

    try {
      // Wait for recording-stopped event data if it arrived
      if (recordingStoppedDataRef.current) {
        await recordingStoppedDataRef.current;
      }

      console.log('Post-stop processing (local-first)...', {
        stop_initiated_at: new Date(stopStartTime).toISOString(),
        current_transcript_count: transcriptsRef.current.length
      });

      // Note: stop_recording is already called by RecordingControls.stopRecordingAction
      // This function only handles post-stop processing

      // Flush buffer with max 5s timeout — Parakeet already processed in real-time
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Flushing transcript buffer...');
      console.log('Flushing transcript buffer...');

      flushBuffer();

      // Brief wait for React state to settle (500ms max)
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('Buffer flush completed', {
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

        console.log('Saving transcripts to database...', {
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

          console.log('Successfully saved meeting with ID:', meetingId);
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
          sessionStorage.removeItem('early_meeting_id');
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Navigate IMMEDIATELY to conversations with localId
          console.log(`[RecordingStop] Navigating to /conversations?localId=${meetingId}`);
          router.push(`/conversations?localId=${meetingId}&source=recording`);
          Analytics.trackPageView('conversations');

          toast.success('Grabacion guardada exitosamente!', {
            description: `${freshTranscripts.length} segmentos de transcripcion guardados.`,
            duration: 5000,
          });

          // Set current meeting and refetch (non-blocking)
          refetchMeetings().catch(() => {});
          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
            }
          } catch (error) {
            setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || 'New Meeting' });
          }

          // --- Enqueue cloud sync (fire-and-forget) ---
          enqueueCloudSync(freshTranscripts, meetingId, savedMeetingName);

          clearTranscripts();
          setStatus(RecordingStatus.IDLE);

          // Track meeting completion analytics (fire-and-forget)
          trackMeetingAnalytics(freshTranscripts, meetingId).catch(e =>
            console.error('Failed to track meeting analytics:', e)
          );

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
    freshTranscripts: any[],
    meetingId: string,
    savedMeetingName: string | null
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
      const transcriptText = freshTranscripts.map(t => {
        const speaker = t.source_type === 'user' ? 'Usuario' : 'Interlocutor';
        return `${speaker}: ${t.text}`;
      }).join('\n');

      let durationSec = 0;
      if (freshTranscripts.length > 0) {
        const lastT = freshTranscripts[freshTranscripts.length - 1];
        durationSec = Math.round(lastT.audio_end_time || lastT.audio_start_time || 0);
      }

      const wordsCount = freshTranscripts
        .map(t => t.text.split(/\s+/).length)
        .reduce((a, b) => a + b, 0);

      const now = new Date().toISOString();
      const startedAt = freshTranscripts[0]?.audio_start_time
        ? new Date(Date.now() - (durationSec * 1000)).toISOString()
        : now;

      const segments = freshTranscripts.map((t, i) => ({
        segment_index: t.sequence_id ?? i,
        text: t.text,
        speaker: t.source_type === 'user' ? 'user' : 'interlocutor',
        speaker_id: t.source_type === 'user' ? 0 : 1,
        is_user: t.source_type === 'user',
        start_time: t.audio_start_time || 0,
        end_time: t.audio_end_time || 0,
      }));

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

      console.log(`[RecordingStop] Enqueued 3 cloud sync jobs for meeting ${meetingId}`);
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
  const trackMeetingAnalytics = useCallback(async (freshTranscripts: any[], meetingId: string) => {
    let durationSeconds = 0;
    if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
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
    (window as any).handleRecordingStop = (callApi: boolean = true) => {
      handleRecordingStopRef.current(callApi);
    };

    // Cleanup on unmount
    return () => {
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
