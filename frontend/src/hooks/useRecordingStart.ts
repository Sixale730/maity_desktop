import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/components/recording/recordingNotification';
import { toast } from 'sonner';

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

interface TranscriptionReadyResult {
  ready: boolean;
  isDownloading: boolean;
  error?: string;
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
    return `Reunión ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Check if transcription is ready based on selected provider
  const checkTranscriptionReady = useCallback(async (): Promise<TranscriptionReadyResult> => {
    const provider = transcriptModelConfig?.provider || 'deepgram';
    console.log(`Checking transcription readiness for provider: ${provider}`);

    try {
      switch (provider) {
        case 'deepgram': {
          // For Deepgram (cloud), just check if API key is configured
          const apiKey = transcriptModelConfig?.apiKey;
          if (apiKey && apiKey.trim().length > 0) {
            console.log('✅ Deepgram API key is configured, ready to record');
            return { ready: true, isDownloading: false };
          }
          console.log('❌ Deepgram API key not configured');
          return {
            ready: false,
            isDownloading: false,
            error: 'Clave API de Deepgram no configurada. Por favor configúrala en Ajustes → Transcripción.'
          };
        }

        case 'parakeet': {
          // For Parakeet, check if local models are available
          try {
            await invoke('parakeet_init');
            const hasModels = await invoke<boolean>('parakeet_has_available_models');
            if (hasModels) {
              console.log('✅ Parakeet models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            // Check if downloading
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
              error: 'Modelo de transcripción Parakeet no disponible.'
            };
          } catch (error) {
            console.error('Failed to check Parakeet status:', error);
            return { ready: false, isDownloading: false, error: 'Error al verificar Parakeet' };
          }
        }

        case 'localWhisper': {
          // For local Whisper, check if models are available
          try {
            await invoke('whisper_init');
            const hasModels = await invoke<boolean>('whisper_has_available_models');
            if (hasModels) {
              console.log('✅ Whisper models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            // Check if downloading
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
              error: 'Modelo de transcripción Whisper no disponible.'
            };
          } catch (error) {
            console.error('Failed to check Whisper status:', error);
            return { ready: false, isDownloading: false, error: 'Error al verificar Whisper' };
          }
        }

        default:
          console.warn(`Unknown provider: ${provider}, defaulting to ready`);
          return { ready: true, isDownloading: false };
      }
    } catch (error) {
      console.error('Failed to check transcription readiness:', error);
      return { ready: false, isDownloading: false, error: 'Error al verificar el estado de transcripción' };
    }
  }, [transcriptModelConfig]);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    try {
      const provider = transcriptModelConfig?.provider || 'deepgram';
      console.log(`handleRecordingStart called - checking ${provider} transcription status`);

      // Check if transcription is ready based on selected provider
      const transcriptionStatus = await checkTranscriptionReady();
      if (!transcriptionStatus.ready) {
        if (transcriptionStatus.isDownloading) {
          toast.info('Descarga de modelo en progreso', {
            description: 'Por favor espera a que el modelo termine de descargarse antes de grabar.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page');
        } else {
          toast.error('Modelo de transcripción no listo', {
            description: transcriptionStatus.error || 'Por favor configura un modelo de transcripción antes de grabar.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Configuración de reconocimiento de voz requerida');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page');
        }
        setStatus(RecordingStatus.IDLE);
        return;
      }

      console.log(`${provider} ready - setting up meeting title and state`);

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      // Start the actual backend recording
      console.log('Starting backend recording with meeting:', randomTitle);
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );
      console.log('Backend recording started successfully');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);
      Analytics.trackButtonClick('start_recording', 'home_page');

      // Show recording notification if enabled
      await showRecordingNotification();
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording');
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkTranscriptionReady, selectedDevices, showModal, setStatus, transcriptModelConfig]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          // Check if transcription is ready based on selected provider
          const transcriptionStatus = await checkTranscriptionReady();
          if (!transcriptionStatus.ready) {
            if (transcriptionStatus.isDownloading) {
              toast.info('Descarga de modelo en progreso', {
                description: 'Por favor espera a que el modelo termine de descargarse antes de grabar.',
                duration: 5000,
              });
              Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_auto');
            } else {
              toast.error('Modelo de transcripción no listo', {
                description: transcriptionStatus.error || 'Por favor configura un modelo de transcripción antes de grabar.',
                duration: 5000,
              });
              showModal?.('modelSelector', 'Configuración de reconocimiento de voz requerida');
              Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_auto');
            }
            setStatus(RecordingStatus.IDLE);
            setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            setStatus(RecordingStatus.STARTING, 'Initializing recording...');

            console.log('Auto-starting backend recording with meeting:', generatedMeetingTitle);
            const result = await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              generatedMeetingTitle
            );
            console.log('Auto-start backend recording result:', result);

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            setMeetingTitle(generatedMeetingTitle);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_recording', 'sidebar_auto');

            // Show recording notification if enabled
            await showRecordingNotification();
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to auto-start recording');
            alert('Failed to start recording. Check console for details.');
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
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkTranscriptionReady,
    showModal,
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
          console.log(`🎤 Meeting detector triggered recording: "${meetingName}"`);

          if (isRecording || isAutoStarting) {
            console.log('Recording already in progress, ignoring detector event');
            return;
          }

          setIsAutoStarting(true);

          // Check if transcription is ready
          const transcriptionStatus = await checkTranscriptionReady();
          if (!transcriptionStatus.ready) {
            toast.error('Modelo de transcripción no listo', {
              description: transcriptionStatus.error || 'Por favor configura un modelo de transcripción antes de grabar.',
              duration: 5000,
            });
            setIsAutoStarting(false);
            return;
          }

          try {
            setStatus(RecordingStatus.STARTING, 'Iniciando grabación...');

            await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              meetingName
            );

            setMeetingTitle(meetingName);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_recording', 'meeting_detector');

            await showRecordingNotification();
            toast.success('Grabación iniciada', {
              description: `Reunión: ${meetingName}`,
              duration: 3000,
            });
          } catch (error) {
            console.error('Failed to start recording from meeting detector:', error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            setStatus(RecordingStatus.ERROR, errorMsg);

            // Categorize errors for user-friendly feedback (matching RecordingControls style)
            if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
              toast.error('Micrófono No Disponible', {
                description: 'Verifica que tu micrófono esté conectado y con permisos.',
                duration: 6000,
              });
            } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
              toast.error('Audio del Sistema No Disponible', {
                description: 'Verifica que un dispositivo de audio virtual esté instalado y configurado.',
                duration: 6000,
              });
            } else if (errorMsg.includes('permission')) {
              toast.error('Permiso Requerido', {
                description: 'Otorga permisos de grabación en Configuración del Sistema.',
                duration: 6000,
              });
            } else {
              toast.error('Error al iniciar grabación', {
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
  }, [isRecording, isAutoStarting, selectedDevices, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkTranscriptionReady, setStatus]);

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

      // Check if transcription is ready based on selected provider
      const transcriptionStatus = await checkTranscriptionReady();
      if (!transcriptionStatus.ready) {
        if (transcriptionStatus.isDownloading) {
          toast.info('Descarga de modelo en progreso', {
            description: 'Por favor espera a que el modelo termine de descargarse antes de grabar.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_direct');
        } else {
          toast.error('Modelo de transcripción no listo', {
            description: transcriptionStatus.error || 'Por favor configura un modelo de transcripción antes de grabar.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Configuración de reconocimiento de voz requerida');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_direct');
        }
        setStatus(RecordingStatus.IDLE);
        setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        setStatus(RecordingStatus.STARTING, 'Initializing recording...');

        console.log('Starting backend recording with meeting:', generatedMeetingTitle);
        const result = await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          generatedMeetingTitle
        );
        console.log('Backend recording result:', result);

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        setMeetingTitle(generatedMeetingTitle);
        setIsRecording(true);
        clearTranscripts();
        setIsMeetingActive(true);
        Analytics.trackButtonClick('start_recording', 'sidebar_direct');

        // Show recording notification if enabled
        await showRecordingNotification();
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording from sidebar');
        alert('Failed to start recording. Check console for details.');
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
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkTranscriptionReady,
    showModal,
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
            description: `${event.device_name || 'Dispositivo desconocido'} se desconectó. La grabación continúa con los dispositivos disponibles.`,
            duration: 8000,
          });
        } else if (event.type === 'DeviceReconnected') {
          toast.success('Dispositivo reconectado', {
            description: `${event.device_name || 'Dispositivo'} se reconectó correctamente.`,
            duration: 5000,
          });
        } else if (event.type === 'DeviceListChanged') {
          toast.info('Cambio en dispositivos de audio', {
            description: 'Se detectó un cambio en los dispositivos de audio disponibles.',
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
