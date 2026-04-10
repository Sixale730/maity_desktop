import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { recordingLogService } from '@/services/recordingLogService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/components/recording/recordingNotification';
import { toast } from 'sonner';
import { getDeepgramProxyConfig, hasValidCachedProxyConfig, DeepgramError } from '@/lib/deepgram';
import type { DeepgramErrorType } from '@/lib/deepgram';


interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

interface TranscriptionReadyResult {
  ready: boolean;
  isDownloading: boolean;
  error?: string;
  errorType?: DeepgramErrorType;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 * - Provider-aware transcription validation (Deepgram, Parakeet, Whisper)
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);
  const isStartingRef = useRef(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices, transcriptModelConfig } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Reunion ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Get appropriate toast title based on error type
  const getErrorToastTitle = useCallback((result: TranscriptionReadyResult): string => {
    switch (result.errorType) {
      case 'auth': return 'Sesion expirada';
      case 'network': return 'Error de conexion';
      case 'server': return 'Error del servidor';
      default: return 'Error de transcripcion';
    }
  }, []);

  // Check if transcription is ready based on selected provider
  const checkTranscriptionReady = useCallback(async (): Promise<TranscriptionReadyResult> => {
    const provider = transcriptModelConfig?.provider || 'deepgram';
    console.log(`Checking transcription readiness for provider: ${provider}`);

    try {
      switch (provider) {
        case 'deepgram': {
          try {
            console.log('[recording] Deepgram: checking auth status and proxy config...');

            if (await hasValidCachedProxyConfig()) {
              console.log('Deepgram proxy config already cached, ready to record');
              return { ready: true, isDownloading: false };
            }

            console.log('Fetching Deepgram proxy config...');
            await getDeepgramProxyConfig();
            console.log('Deepgram proxy config obtained and cached, ready to record');

            return { ready: true, isDownloading: false };
          } catch (error) {
            console.error('Failed to get Deepgram proxy config:', error);

            if (error instanceof DeepgramError) {
              return {
                ready: false,
                isDownloading: false,
                error: error.message,
                errorType: error.errorType,
              };
            }

            const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
            return {
              ready: false,
              isDownloading: false,
              error: errorMsg,
              errorType: 'unknown',
            };
          }
        }

        case 'parakeet': {
          try {
            await invoke('parakeet_init');
            const hasModels = await invoke<boolean>('parakeet_has_available_models');
            if (hasModels) {
              console.log('Parakeet models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<any[]>('parakeet_get_available_models');
            const isDownloading = models.some(m =>
              m.status && (
                typeof m.status === 'object'
                  ? 'Downloading' in m.status
                  : m.status === 'Downloading'
              )
            );

            return {
              ready: false,
              isDownloading,
              error: isDownloading
                ? 'El modelo de transcripcion se esta descargando. Podras grabar cuando termine.'
                : 'Modelo de transcripcion no disponible. Reinicia la app para iniciar la descarga.'
            };
          } catch (error) {
            console.error('Failed to check Parakeet status:', error);
            return { ready: false, isDownloading: false, error: 'Error al verificar Parakeet' };
          }
        }

        case 'localWhisper': {
          try {
            await invoke('whisper_init');
            const hasModels = await invoke<boolean>('whisper_has_available_models');
            if (hasModels) {
              console.log('Whisper models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<any[]>('whisper_get_available_models');
            const isDownloading = models.some(m =>
              m.status && (
                typeof m.status === 'object'
                  ? 'Downloading' in m.status
                  : m.status === 'Downloading'
              )
            );

            return {
              ready: false,
              isDownloading,
              error: 'Modelo de transcripcion Whisper no disponible.'
            };
          } catch (error) {
            console.error('Failed to check Whisper status:', error);
            return { ready: false, isDownloading: false, error: 'Error al verificar Whisper' };
          }
        }

        case 'moonshine': {
          try {
            await invoke('moonshine_init');
            const hasModels = await invoke<boolean>('moonshine_has_available_models');
            if (hasModels) {
              console.log('Moonshine models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<any[]>('moonshine_get_available_models');
            const isDownloading = models.some(m =>
              m.status && (
                typeof m.status === 'object'
                  ? 'Downloading' in m.status
                  : m.status === 'Downloading'
              )
            );

            return {
              ready: false,
              isDownloading,
              error: 'Modelo de transcripcion Moonshine no disponible.'
            };
          } catch (error) {
            console.error('Failed to check Moonshine status:', error);
            return { ready: false, isDownloading: false, error: 'Error al verificar Moonshine' };
          }
        }

        default:
          console.warn(`Unknown provider: ${provider}, defaulting to ready`);
          return { ready: true, isDownloading: false };
      }
    } catch (error) {
      console.error('Failed to check transcription readiness:', error);
      return { ready: false, isDownloading: false, error: 'Error al verificar el estado de transcripcion' };
    }
  }, [transcriptModelConfig]);

  /**
   * Shared recording start flow — used by manual, auto-start, sidebar-direct, and meeting-detector triggers.
   * Handles: generate title -> log -> create early meeting -> start backend -> update UI state.
   */
  const startRecordingFlow = useCallback(async (
    trigger: string,
    meetingNameOverride?: string,
  ) => {
    const title = meetingNameOverride || generateMeetingTitle();

    // Start logging session
    recordingLogService.startSession();
    recordingLogService.log('recording_started', {
      meeting_title: title,
      mic_device: selectedDevices?.micDevice || null,
      system_device: selectedDevices?.systemDevice || null,
      provider: transcriptModelConfig?.provider || 'deepgram',
      trigger,
    }, 'success');

    // Generate meeting ID in frontend (no DB insert — meeting created atomically when saving transcripts)
    const meetingId = `meeting-${crypto.randomUUID()}`;
    recordingLogService.setMeetingId(meetingId);
    sessionStorage.setItem('early_meeting_id', meetingId);
    recordingLogService.log('meeting_id_generated', { meeting_id: meetingId }, 'success');

    // Set STARTING status before initiating backend recording
    setStatus(RecordingStatus.STARTING, 'Initializing recording...');

    // Start the actual backend recording
    console.log(`Starting backend recording (trigger=${trigger}) with meeting:`, title);
    await recordingService.startRecordingWithDevices(
      selectedDevices?.micDevice || null,
      selectedDevices?.systemDevice || null,
      title
    );
    console.log('Backend recording started successfully');

    // Update UI state after successful backend start
    // Note: RECORDING status will be set by RecordingStateContext event listener
    setMeetingTitle(title);
    setIsRecording(true);
    clearTranscripts();
    setIsMeetingActive(true);
    Analytics.trackButtonClick('start_recording', trigger);

    // Show recording notification if enabled
    await showRecordingNotification();

    // Native OS notification
    import('@/lib/nativeNotification').then(({ sendNativeNotification }) =>
      sendNativeNotification({
        title: 'Grabación iniciada',
        body: `Reunión: ${title}`,
      })
    ).catch(() => {});
  }, [generateMeetingTitle, selectedDevices, transcriptModelConfig, setStatus, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive]);

  /**
   * Handle transcription not ready — show appropriate toast/modal.
   */
  const handleTranscriptionNotReady = useCallback((
    transcriptionStatus: TranscriptionReadyResult,
    trigger: string
  ) => {
    if (transcriptionStatus.isDownloading) {
      toast.info('Descarga de modelo en progreso', {
        description: 'Por favor espera a que el modelo termine de descargarse antes de grabar.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_downloading', trigger);
    } else {
      const toastTitle = transcriptionStatus.errorType
        ? getErrorToastTitle(transcriptionStatus)
        : 'Modelo de transcripcion no listo';
      toast.error(toastTitle, {
        description: transcriptionStatus.error || 'Por favor configura un modelo de transcripcion antes de grabar.',
        duration: 5000,
      });
      if (!transcriptionStatus.errorType || transcriptionStatus.errorType === 'unknown') {
        showModal?.('modelSelector', 'Configuracion de reconocimiento de voz requerida');
      }
      Analytics.trackButtonClick('start_recording_blocked_missing', trigger);
    }
    setStatus(RecordingStatus.IDLE);
  }, [getErrorToastTitle, showModal, setStatus]);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    if (isStartingRef.current) {
      console.log('[recording] Start already in progress, ignoring click');
      return;
    }
    isStartingRef.current = true;

    try {
      const provider = transcriptModelConfig?.provider || 'deepgram';
      console.log(`handleRecordingStart called - checking ${provider} transcription status`);

      const transcriptionStatus = await checkTranscriptionReady();
      if (!transcriptionStatus.ready) {
        handleTranscriptionNotReady(transcriptionStatus, 'home_page');
        return;
      }

      console.log(`${provider} ready - starting recording flow`);
      await startRecordingFlow('manual');
    } catch (error) {
      console.error('Failed to start recording:', error);
      recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording');
      setIsRecording(false);
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    } finally {
      isStartingRef.current = false;
    }
  }, [checkTranscriptionReady, handleTranscriptionNotReady, startRecordingFlow, setStatus, setIsRecording, transcriptModelConfig]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording');

          const transcriptionStatus = await checkTranscriptionReady();
          if (!transcriptionStatus.ready) {
            handleTranscriptionNotReady(transcriptionStatus, 'sidebar_auto');
            setIsAutoStarting(false);
            return;
          }

          try {
            await startRecordingFlow('auto_start');
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to auto-start recording');
            Analytics.trackButtonClick('start_recording_error', 'sidebar_auto');
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [
    isRecording,
    isAutoStarting,
    checkTranscriptionReady,
    handleTranscriptionNotReady,
    startRecordingFlow,
    setStatus,
  ]);

  // Listen for recording trigger from meeting detector (Tauri event)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupMeetingDetectorListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string>('start-recording-from-detector', async (event) => {
          const meetingName = event.payload;
          console.log(`Meeting detector triggered recording: "${meetingName}"`);

          if (isRecording || isAutoStarting) {
            console.log('Recording already in progress, ignoring detector event');
            return;
          }

          setIsAutoStarting(true);

          const transcriptionStatus = await checkTranscriptionReady();
          if (!transcriptionStatus.ready) {
            handleTranscriptionNotReady(transcriptionStatus, 'meeting_detector');
            setIsAutoStarting(false);
            return;
          }

          try {
            await startRecordingFlow('meeting_detector', meetingName);
            toast.success('Grabacion iniciada', {
              description: `Reunion: ${meetingName}`,
              duration: 3000,
            });
          } catch (error) {
            console.error('Failed to start recording from meeting detector:', error);
            recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
            const errorMsg = error instanceof Error ? error.message : String(error);
            setStatus(RecordingStatus.ERROR, errorMsg);

            if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
              toast.error('Microfono No Disponible', {
                description: 'Verifica que tu microfono este conectado y con permisos.',
                duration: 6000,
              });
            } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
              toast.error('Audio del Sistema No Disponible', {
                description: 'Verifica que un dispositivo de audio virtual este instalado y configurado.',
                duration: 6000,
              });
            } else if (errorMsg.includes('permission')) {
              toast.error('Permiso Requerido', {
                description: 'Otorga permisos de grabacion en Configuracion del Sistema.',
                duration: 6000,
              });
            } else {
              toast.error('Error al iniciar grabacion', {
                description: errorMsg,
                duration: 5000,
              });
            }
          } finally {
            setIsAutoStarting(false);
          }
        });
      } catch (error) {
        console.error('Failed to setup meeting detector listener:', error);
      }
    };

    setupMeetingDetectorListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isRecording, isAutoStarting, checkTranscriptionReady, handleTranscriptionNotReady, startRecordingFlow, setStatus]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      const provider = transcriptModelConfig?.provider || 'deepgram';
      console.log(`Direct start from sidebar - checking ${provider} transcription status`);
      setIsAutoStarting(true);

      const transcriptionStatus = await checkTranscriptionReady();
      if (!transcriptionStatus.ready) {
        handleTranscriptionNotReady(transcriptionStatus, 'sidebar_direct');
        setIsAutoStarting(false);
        return;
      }

      try {
        await startRecordingFlow('sidebar_direct');
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording from sidebar');
        Analytics.trackButtonClick('start_recording_error', 'sidebar_direct');
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [
    isRecording,
    isAutoStarting,
    checkTranscriptionReady,
    handleTranscriptionNotReady,
    startRecordingFlow,
    setStatus,
    transcriptModelConfig,
  ]);

  // B3: Poll for audio device events during recording (disconnect/reconnect)
  useEffect(() => {
    if (!isRecording) return;

    const intervalId = setInterval(async () => {
      try {
        const event = await invoke<{ type: string; device_name?: string; device_type?: string } | null>('poll_audio_device_events');
        if (!event) return;

        if (event.type === 'DeviceDisconnected') {
          toast.warning('Dispositivo de audio desconectado', {
            description: `${event.device_name || 'Dispositivo desconocido'} se desconecto. La grabacion continua con los dispositivos disponibles.`,
            duration: 8000,
          });
        } else if (event.type === 'DeviceReconnected') {
          toast.success('Dispositivo reconectado', {
            description: `${event.device_name || 'Dispositivo'} se reconecto correctamente.`,
            duration: 5000,
          });
        } else if (event.type === 'DeviceListChanged') {
          toast.info('Cambio en dispositivos de audio', {
            description: 'Se detecto un cambio en los dispositivos de audio disponibles.',
            duration: 4000,
          });
        }
      } catch (error) {
        // Silently ignore polling errors (e.g., recording stopped between interval ticks)
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [isRecording]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
