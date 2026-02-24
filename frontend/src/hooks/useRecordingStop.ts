import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import { transcriptService } from '@/services/transcriptService';
import { recordingLogService } from '@/services/recordingLogService';
import Analytics from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { invoke } from '@tauri-apps/api/core';
import {
  saveConversationToSupabase,
  saveTranscriptSegments,
} from '@/features/conversations/services/conversations.service';
import { supabase } from '@/lib/supabase';
import { withRetry } from '@/lib/retry';

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
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion polling (60s max, 500ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to meeting details
 * - Toast notifications for success/error
 * - Window exposure for Rust callbacks
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
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
    setMeetings,
    meetings,
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

  // Main recording stop handler
  const handleRecordingStop = useCallback(async (isCallApi: boolean) => {
    if (recordingStoppedDataRef.current) {
      await recordingStoppedDataRef.current;
    }

    // Guard: prevent duplicate/concurrent stop calls
    if (stopInProgressRef.current) {
      return;
    }
    stopInProgressRef.current = true;

    // Set status to STOPPING immediately
    setStatus(RecordingStatus.STOPPING);
    setIsRecording(false);
    setIsRecordingDisabled(true);
    const stopStartTime = Date.now();

    // Log recording stopped
    recordingLogService.log('recording_stopped', {
      transcript_count: transcriptsRef.current.length,
    }, 'success');

    try {
      console.log('Post-stop processing (new implementation)...', {
        stop_initiated_at: new Date(stopStartTime).toISOString(),
        current_transcript_count: transcriptsRef.current.length
      });

      // Note: stop_recording is already called by RecordingControls.stopRecordingAction
      // This function only handles post-stop processing (transcription wait, API call, navigation)
      console.log('Recording already stopped by RecordingControls, processing transcription...');

      // Wait for transcription to complete
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Waiting for transcription...');
      console.log('Waiting for transcription to complete...');
      recordingLogService.log('transcription_wait_started', null, 'success');

      const MAX_WAIT_TIME = 60000; // 60 seconds maximum wait (increased for longer processing)
      const POLL_INTERVAL = 500; // Check every 500ms
      let elapsedTime = 0;
      let transcriptionComplete = false;

      // Listen for transcription-complete event
      const unlistenComplete = await listen('transcription-complete', () => {
        console.log('Received transcription-complete event');
        transcriptionComplete = true;
      });

      // Poll for transcription status
      while (elapsedTime < MAX_WAIT_TIME && !transcriptionComplete) {
        try {
          const status = await transcriptService.getTranscriptionStatus();
          console.log('Transcription status:', status);

          // Check if transcription is complete
          if (!status.is_processing && status.chunks_in_queue === 0) {
            console.log('Transcription complete - no active processing and no chunks in queue');
            transcriptionComplete = true;
            break;
          }

          // If no activity for more than 8 seconds and no chunks in queue, consider it done (increased from 5s to 8s)
          if (status.last_activity_ms > 8000 && status.chunks_in_queue === 0) {
            console.log('Transcription likely complete - no recent activity and empty queue');
            transcriptionComplete = true;
            break;
          }

          // Update user with current status
          if (status.chunks_in_queue > 0) {
            console.log(`Processing ${status.chunks_in_queue} remaining audio chunks...`);
            setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, `Processing ${status.chunks_in_queue} remaining chunks...`);
          }

          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
          elapsedTime += POLL_INTERVAL;
        } catch (error) {
          console.error('Error checking transcription status:', error);
          break;
        }
      }

      // Clean up listener
      console.log('🧹 CLEANUP: Cleaning up transcription-complete listener');
      unlistenComplete();

      if (!transcriptionComplete && elapsedTime >= MAX_WAIT_TIME) {
        console.warn('⏰ Transcription wait timeout reached after', elapsedTime, 'ms');
        recordingLogService.log('transcription_wait_timeout', { elapsed_ms: elapsedTime }, 'timeout');
      } else {
        console.log('✅ Transcription completed after', elapsedTime, 'ms');
        recordingLogService.log('transcription_wait_completed', { elapsed_ms: elapsedTime }, 'success');
        // Wait longer for any late transcript segments (increased from 1s to 4s)
        console.log('⏳ Waiting for late transcript segments...');
        await new Promise(resolve => setTimeout(resolve, 4000));
      }

      // Final buffer flush: process ALL remaining transcripts regardless of timing
      const flushStartTime = Date.now();
      console.log('🔄 Final buffer flush: forcing processing of any remaining transcripts...', {
        flush_started_at: new Date(flushStartTime).toISOString(),
        time_since_stop: flushStartTime - stopStartTime,
        current_transcript_count: transcriptsRef.current.length
      });
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Flushing transcript buffer...');
      flushBuffer();
      const flushEndTime = Date.now();
      console.log('✅ Final buffer flush completed', {
        flush_duration: flushEndTime - flushStartTime,
        total_time_since_stop: flushEndTime - stopStartTime,
        final_transcript_count: transcriptsRef.current.length
      });
      recordingLogService.log('buffer_flush_completed', {
        flush_duration_ms: flushEndTime - flushStartTime,
        final_transcript_count: transcriptsRef.current.length,
      }, 'success');

      // NOTE: Status remains PROCESSING_TRANSCRIPTS until we start saving

      // Wait a bit more to ensure all transcript state updates have been processed
      console.log('Waiting for transcript state updates to complete...');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Save to SQLite
      // NOTE: enabled to save COMPLETE transcripts after frontend receives all updates
      // This ensures user sees all transcripts streaming in before database save
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

        console.log('💾 Saving COMPLETE transcripts to database...', {
          transcript_count: freshTranscripts.length,
          meeting_name: savedMeetingName || meetingTitle,
          folder_path: folderPath,
          early_meeting_id: earlyMeetingId,
          sample_text: freshTranscripts.length > 0 ? freshTranscripts[0].text.substring(0, 50) + '...' : 'none',
          last_transcript: freshTranscripts.length > 0 ? freshTranscripts[freshTranscripts.length - 1].text.substring(0, 30) + '...' : 'none',
        });

        try {
          const responseData = await storageService.saveMeeting(
            savedMeetingName || meetingTitle || 'New Meeting',  // PREFER savedMeetingName (backend source)
            freshTranscripts,
            folderPath,
            earlyMeetingId
          );

          const meetingId = responseData.meeting_id;
          if (!meetingId) {
            console.error('No meeting_id in response:', responseData);
            throw new Error('No meeting ID received from save operation');
          }

          console.log('✅ Successfully saved COMPLETE meeting with ID:', meetingId);
          console.log('   Transcripts:', freshTranscripts.length);
          console.log('   folder_path:', folderPath);
          recordingLogService.setMeetingId(meetingId);
          recordingLogService.log('sqlite_save_succeeded', {
            meeting_id: meetingId,
            transcript_count: freshTranscripts.length,
          }, 'success');

          // --- Save to Supabase (blocking) + DeepSeek eval (fire-and-forget) ---
          let conversationId: string | null = null;

          // Diagnostic logging: auth state at save time
          console.log('[RecordingStop] Auth state:', {
            maityUser_id: maityUser?.id ?? 'NULL',
            maityUser_status: maityUser?.status ?? 'N/A',
            transcript_count: freshTranscripts.length,
            will_attempt_supabase: !!(maityUser?.id && freshTranscripts.length > 0),
          });

          // Fallback: if maityUser is null but Supabase session exists (race condition)
          let effectiveMaityUser = maityUser;
          if (!effectiveMaityUser?.id && freshTranscripts.length > 0) {
            try {
              const { data: { session: currentSession } } = await supabase.auth.getSession();
              if (currentSession?.user) {
                console.warn('[RecordingStop] maityUser null but session exists, fetching user...');
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

          if (effectiveMaityUser?.id && freshTranscripts.length > 0) {
            const cloudToastId = toast.loading('Guardando en la nube...');
            recordingLogService.log('supabase_save_attempted', null, 'success');
            try {
              // Refresh session to prevent expired token errors on long recordings
              try {
                const { data: { session: currentSession } } = await supabase.auth.getSession();
                if (!currentSession) {
                  await supabase.auth.refreshSession();
                }
              } catch (e) {
                console.warn('[RecordingStop] Session refresh failed:', e);
              }

              console.log('Saving conversation to Supabase for user:', effectiveMaityUser.id);

              // Build transcript text with speaker labels
              const transcriptText = freshTranscripts.map(t => {
                const speaker = t.source_type === 'user' ? 'Usuario' : 'Interlocutor';
                return `${speaker}: ${t.text}`;
              }).join('\n');

              // Calculate duration from transcripts
              let durationSec = 0;
              if (freshTranscripts.length > 0) {
                const lastT = freshTranscripts[freshTranscripts.length - 1];
                durationSec = Math.round(lastT.audio_end_time || lastT.audio_start_time || 0);
              }

              // Calculate word count
              const wordsCount = freshTranscripts
                .map(t => t.text.split(/\s+/).length)
                .reduce((a, b) => a + b, 0);

              // Timestamps
              const now = new Date().toISOString();
              const startedAt = freshTranscripts[0]?.audio_start_time
                ? new Date(Date.now() - (durationSec * 1000)).toISOString()
                : now;

              // 1. Save conversation BLOCKING with retry + 15s timeout
              conversationId = await Promise.race([
                withRetry(
                  () => saveConversationToSupabase({
                    user_id: effectiveMaityUser!.id,
                    title: savedMeetingName || meetingTitle || 'Nueva Reunión',
                    started_at: startedAt,
                    finished_at: now,
                    transcript_text: transcriptText,
                    source: 'maity_desktop',
                    language: transcriptModelConfig?.language || 'es',
                    words_count: wordsCount,
                    duration_seconds: durationSec,
                  }),
                  {
                    maxRetries: 1,
                    initialDelay: 1000,
                    onRetry: (attempt, error) => {
                      console.warn(`[RecordingStop] Supabase retry ${attempt}:`, error);
                    },
                  }
                ),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Supabase save timeout (15s)')), 15000)
                ),
              ]);
              console.log('Conversation saved to Supabase:', conversationId);

              // 2. Save transcript segments BLOCKING
              const segments = freshTranscripts.map((t, i) => ({
                segment_index: t.sequence_id ?? i,
                text: t.text,
                speaker: t.source_type === 'user' ? 'SPEAKER_0' : 'SPEAKER_1',
                speaker_id: t.source_type === 'user' ? 0 : 1,
                is_user: t.source_type === 'user',
                start_time: t.audio_start_time || 0,
                end_time: t.audio_end_time || 0,
              }));
              await saveTranscriptSegments(conversationId, effectiveMaityUser!.id, segments);
              console.log('Transcript segments saved:', segments.length);
              toast.success('Guardado en la nube', { id: cloudToastId, duration: 3000 });
              recordingLogService.log('supabase_save_succeeded', { conversation_id: conversationId }, 'success');

              // 3. Finalize conversation via Vercel API ASYNC (fire-and-forget)
              // The endpoint evaluates with LLM, generates embeddings, memories, and daily scores.
              // All results are written directly to Supabase server-side.
              (async () => {
                const evalToastId = toast.loading('Analizando con Maity...');
                recordingLogService.log('cloud_finalize_attempted', { conversation_id: conversationId }, 'success');
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const accessToken = session?.access_token;
                  if (!accessToken) {
                    throw new Error('No hay sesión activa para analizar la conversación');
                  }

                  let evalSuccess = false;
                  for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                      console.log(`Finalize conversation attempt ${attempt}...`);
                      const result = await invoke<{ ok: boolean; error?: string }>('finalize_conversation_cloud', {
                        conversationId,
                        durationSeconds: durationSec,
                        accessToken,
                      });

                      if (result.ok) {
                        evalSuccess = true;
                        console.log('Conversation finalized successfully');
                        break;
                      } else {
                        console.warn(`Finalize attempt ${attempt} returned ok=false:`, result.error);
                        if (attempt === 2) throw new Error(result.error || 'Finalize returned ok=false');
                      }
                    } catch (err) {
                      console.warn(`Finalize attempt ${attempt} failed:`, err);
                      if (attempt === 2) throw err;
                    }
                  }

                  if (evalSuccess) {
                    toast.success('Analisis de comunicacion completado', { id: evalToastId, duration: 5000 });
                    recordingLogService.log('cloud_finalize_succeeded', { conversation_id: conversationId }, 'success');
                    // Notify ConversationDetail (already mounted) to refetch
                    window.dispatchEvent(new CustomEvent('finalize-completed', {
                      detail: { conversationId },
                    }));
                  } else {
                    toast.dismiss(evalToastId);
                  }
                } catch (err) {
                  console.error('Finalize conversation error:', err);
                  recordingLogService.log('cloud_finalize_failed', null, 'error', err instanceof Error ? err.message : String(err));
                  toast.error('Error en analisis de comunicacion', {
                    id: evalToastId,
                    duration: 10000,
                    description: 'Puedes reanalizar manualmente desde la conversacion.',
                  });
                }
              })();
            } catch (err) {
              console.error('[RecordingStop] Supabase save FAILED:', err);
              const errorMsg = err instanceof Error ? err.message : String(err);
              recordingLogService.log('supabase_save_failed', {
                error_type: err instanceof Error ? err.constructor.name : typeof err,
                user_id: effectiveMaityUser?.id,
              }, 'error', errorMsg);

              toast.dismiss(cloudToastId);
              toast.error('Error al guardar en la nube', {
                description: `La grabación se guardó localmente. Detalle: ${errorMsg}`,
                duration: 8000,
              });
              conversationId = null;
            }
          }

          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          sessionStorage.removeItem('early_meeting_id');
          // Clean up IndexedDB meeting ID (redundant with markMeetingAsSaved cleanup, but ensures cleanup)
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Refetch meetings and set current meeting
          await refetchMeetings();

          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
              console.log('✅ Current meeting set:', meetingData.title);
            }
          } catch (error) {
            console.warn('Could not fetch meeting details, using ID only:', error);
            setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || 'New Meeting' });
          }

          // Mark as completed
          setStatus(RecordingStatus.COMPLETED);

          // Show contextual toast based on save result
          if (conversationId) {
            toast.success('¡Grabación guardada exitosamente!', {
              description: `${freshTranscripts.length} segmentos guardados. Redirigiendo al análisis...`,
              duration: 4000,
            });
          } else if (effectiveMaityUser?.id) {
            // User logged in but cloud save failed — error toast already shown above
            toast.info('Grabación guardada localmente', {
              description: `${freshTranscripts.length} segmentos guardados. El análisis en la nube no está disponible.`,
              duration: 6000,
            });
          } else {
            toast.success('¡Grabación guardada exitosamente!', {
              description: `${freshTranscripts.length} segmentos de transcripción guardados.`,
              duration: 5000,
            });
          }

          // Auto-navigate: prefer conversations view if Supabase save succeeded, fallback to meeting-details
          setTimeout(() => {
            if (conversationId) {
              router.push(`/conversations?id=${conversationId}&source=recording`);
              Analytics.trackPageView('conversations_detail');
            } else {
              router.push(`/meeting-details?id=${meetingId}&source=recording`);
              Analytics.trackPageView('meeting_details');
            }
            clearTranscripts();

            // Reset to IDLE after navigation
            setStatus(RecordingStatus.IDLE);
          }, 1500);
          // Track meeting completion analytics
          try {
            // Calculate meeting duration from transcript timestamps
            let durationSeconds = 0;
            if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
              // Use audio_end_time of last transcript if available
              const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
              durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
            }

            // Calculate word count
            const transcriptWordCount = freshTranscripts
              .map(t => t.text.split(/\s+/).length)
              .reduce((a, b) => a + b, 0);

            // Calculate words per minute
            const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;

            // Get meetings count today
            const meetingsToday = await Analytics.getMeetingsCountToday();

            // Track meeting completed
            await Analytics.trackMeetingCompleted(meetingId, {
              duration_seconds: durationSeconds,
              transcript_segments: freshTranscripts.length,
              transcript_word_count: transcriptWordCount,
              words_per_minute: wordsPerMinute,
              meetings_today: meetingsToday
            });

            // Update meeting count in analytics.json
            await Analytics.updateMeetingCount();

            // Check for activation (first meeting)
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
          } catch (analyticsError) {
            console.error('Failed to track meeting completion analytics:', analyticsError);
            // Don't block user flow on analytics errors
          }

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          recordingLogService.log('sqlite_save_failed', null, 'error', saveError instanceof Error ? saveError.message : String(saveError));
          setStatus(RecordingStatus.ERROR, saveError instanceof Error ? saveError.message : 'Unknown error');
          toast.error('Error al guardar reunión', {
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
      // isRecording already set to false at function start
      setIsRecordingDisabled(false);

      // Sync recording logs to cloud (fire-and-forget)
      recordingLogService.syncToCloud();
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
      // isRecording already set to false at function start
      setIsRecordingDisabled(false);
    } finally {
      // Always reset the guard flag when done
      stopInProgressRef.current = false;
    }
  }, [
    setIsRecording,
    setIsRecordingDisabled,
    setStatus,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
    router,
    maityUser,
    transcriptModelConfig,
  ]);

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
