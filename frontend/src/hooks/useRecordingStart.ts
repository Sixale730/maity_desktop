import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  PRESENTER_MODE_FEATURE,
  QUOTA_STATUS_QUERY_KEY,
  isFeatureEnabled,
  type QuotaStatus,
} from '@/hooks/usePlanStatus';
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
import { logger } from '@/lib/logger';
import { TauriEvent } from '@/lib/tauri-events';
import { DEFAULT_TRANSCRIPTION_PROVIDER } from '@/lib/transcription-providers';


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
  const { selectedDevices, transcriptModelConfig, recordingMode } = useConfig();
  const { setStatus } = useRecordingState();
  const queryClient = useQueryClient();
  const { maityUser } = useAuth();

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
    // Config sin cargar NO es "usa el default": es "todavía no sé cuál motor
    // validar". Adoptar un default aquí hacía que la app validara un proveedor
    // distinto del que iba a transcribir y autorizara grabaciones que nunca
    // producirían texto. Fail-closed: sin config, no se graba.
    if (!transcriptModelConfig?.provider) {
      logger.debug('[recording] transcriptModelConfig aún no cargó — no se autoriza grabar');
      return {
        ready: false,
        isDownloading: false,
        error: 'La configuración de transcripción aún no ha cargado. Intenta de nuevo en unos segundos.',
      };
    }

    const provider = transcriptModelConfig.provider;
    logger.debug(`Checking transcription readiness for provider: ${provider}`);

    try {
      switch (provider) {
        case 'deepgram': {
          try {
            logger.debug('[recording] Deepgram: checking auth status and proxy config...');

            if (await hasValidCachedProxyConfig()) {
              logger.debug('Deepgram proxy config already cached, ready to record');
              return { ready: true, isDownloading: false };
            }

            logger.debug('Fetching Deepgram proxy config...');
            await getDeepgramProxyConfig();
            logger.debug('Deepgram proxy config obtained and cached, ready to record');

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
              logger.debug('Parakeet models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<{ status?: string | Record<string, unknown> }[]>('parakeet_get_available_models');
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
              logger.debug('Whisper models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<{ status?: string | Record<string, unknown> }[]>('whisper_get_available_models');
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
              logger.debug('Moonshine models available, ready to record');
              return { ready: true, isDownloading: false };
            }

            const models = await invoke<{ status?: string | Record<string, unknown> }[]>('moonshine_get_available_models');
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
          // Fail-closed: un proveedor que no sabemos verificar no puede
          // autorizar una grabación. Antes esto devolvía ready:true, así que
          // cualquier valor inesperado de config abría paso a grabar sin motor.
          console.error(`Unknown transcription provider: ${provider}`);
          return {
            ready: false,
            isDownloading: false,
            error: `Proveedor de transcripción desconocido: ${provider}`,
          };
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
      provider: transcriptModelConfig?.provider || DEFAULT_TRANSCRIPTION_PROVIDER,
      trigger,
    }, 'success');

    // Generate meeting ID in frontend (no DB insert — meeting created atomically when saving transcripts)
    const meetingId = `meeting-${crypto.randomUUID()}`;
    recordingLogService.setMeetingId(meetingId);
    sessionStorage.setItem('early_meeting_id', meetingId);
    // Modo Ponente: gating por plan. El valor persistido en localStorage puede ser
    // 'presentation' de una sesión con plan superior — si el plan actual no lo
    // permite, se graba en modo conversación (sin tocar la preferencia guardada:
    // revive sola al volver a Pro). Se lee del cache de queryClient (no un hook)
    // para no suscribir el path de arranque; cache frío → fail-open.
    const quotaCache = queryClient.getQueryData<QuotaStatus | null>([
      QUOTA_STATUS_QUERY_KEY,
      maityUser?.id,
    ]);
    const effectiveMode =
      recordingMode === 'presentation' && !isFeatureEnabled(quotaCache, PRESENTER_MODE_FEATURE)
        ? 'conversation'
        : recordingMode;
    if (effectiveMode !== recordingMode) {
      logger.info('[RecordingStart] Modo ponente no disponible en el plan; grabando en modo conversación');
      toast.info('Modo ponente no disponible en tu plan', {
        description: 'Esta grabación se hará en modo conversación.',
      });
    }
    // Persistir el modo de ESTA sesión para que el stop (que persiste el
    // meeting y dispara el sync a la nube) lo lea. sessionStorage espeja el patrón de
    // 'early_meeting_id' y sobrevive navegación durante la grabación.
    sessionStorage.setItem('active_recording_mode', effectiveMode);
    recordingLogService.log('meeting_id_generated', { meeting_id: meetingId, recording_mode: effectiveMode }, 'success');

    // Set STARTING status before initiating backend recording
    setStatus(RecordingStatus.STARTING, 'Initializing recording...');

    // Start the actual backend recording
    logger.debug(`Starting backend recording (trigger=${trigger}, mode=${effectiveMode}) with meeting:`, title);
    await recordingService.startRecordingWithDevices(
      selectedDevices?.micDevice || null,
      selectedDevices?.systemDevice || null,
      title,
      effectiveMode
    );
    logger.debug('Backend recording started successfully');

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
  }, [generateMeetingTitle, selectedDevices, transcriptModelConfig, recordingMode, setStatus, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, queryClient, maityUser?.id]);

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
      logger.debug('[recording] Start already in progress, ignoring click');
      return;
    }
    isStartingRef.current = true;

    try {
      const provider = transcriptModelConfig?.provider || DEFAULT_TRANSCRIPTION_PROVIDER;
      logger.debug(`handleRecordingStart called - checking ${provider} transcription status`);

      const transcriptionStatus = await checkTranscriptionReady();
      if (!transcriptionStatus.ready) {
        handleTranscriptionNotReady(transcriptionStatus, 'home_page');
        return;
      }

      logger.debug(`${provider} ready - starting recording flow`);
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
        // Guard SÍNCRONO (ref), no `isAutoStarting`: el estado de React se
        // aplica en el siguiente render, así que dos disparos en el mismo tick
        // pasaban ambos el if. Ver el comentario del guard en handleDirectStart.
        if (shouldAutoStart === 'true' && !isRecording && !isStartingRef.current) {
          isStartingRef.current = true;
          logger.debug('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording');

          try {
            const transcriptionStatus = await checkTranscriptionReady();
            if (!transcriptionStatus.ready) {
              handleTranscriptionNotReady(transcriptionStatus, 'sidebar_auto');
              return;
            }

            await startRecordingFlow('auto_start');
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to auto-start recording');
            setIsRecording(false);
            Analytics.trackButtonClick('start_recording_error', 'sidebar_auto');
          } finally {
            setIsAutoStarting(false);
            isStartingRef.current = false;
          }
        }
      }
    };

    checkAutoStartRecording();
    // `isAutoStarting` ya no es dependencia: el guard es isStartingRef (síncrono),
    // así que el efecto no necesita re-correr cuando cambia el estado transitorio.
  }, [
    isRecording,
    checkTranscriptionReady,
    handleTranscriptionNotReady,
    startRecordingFlow,
    setStatus,
    setIsRecording,
  ]);

  // Listen for recording trigger from meeting detector (Tauri event).
  //
  // Issue #65: este efecto llevaba seis dependencias inestables, así que se
  // desuscribía y resuscribía al MISMO evento en cada render. Ahora monta una
  // sola vez y lee todo del latest-ref.
  const detectorLatest = useRef({
    isRecording, checkTranscriptionReady,
    handleTranscriptionNotReady, startRecordingFlow, setStatus, setIsRecording,
  });
  detectorLatest.current = {
    isRecording, checkTranscriptionReady,
    handleTranscriptionNotReady, startRecordingFlow, setStatus, setIsRecording,
  };

  useEffect(() => {
    const subs = createSubscriptionGroup();

    const setupMeetingDetectorListener = async () => {
      try {
        subs.on<string>(TauriEvent.START_RECORDING_FROM_DETECTOR, async (event) => {
          const {
            isRecording, checkTranscriptionReady,
            handleTranscriptionNotReady, startRecordingFlow, setStatus, setIsRecording,
          } = detectorLatest.current;
          const meetingName = event.payload;
          logger.debug(`Meeting detector triggered recording: "${meetingName}"`);

          // Guard SÍNCRONO: `isAutoStarting` viene del latest-ref pero sigue
          // siendo estado de React (valor del último render). isStartingRef se
          // escribe en el mismo tick, así que dos eventos seguidos no pasan los dos.
          if (isRecording || isStartingRef.current) {
            logger.debug('Recording already in progress, ignoring detector event');
            return;
          }

          isStartingRef.current = true;
          setIsAutoStarting(true);

          try {
            const transcriptionStatus = await checkTranscriptionReady();
            if (!transcriptionStatus.ready) {
              handleTranscriptionNotReady(transcriptionStatus, 'meeting_detector');
              return;
            }

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
            setIsRecording(false);

            // Los errores de DISPOSITIVO ya no se clasifican aquí: Rust los
            // clasifica por HRESULT y emite AUDIO_DEVICE_ERROR, que
            // useMicrophoneFallbackToast convierte en un toast con remediación
            // para los cuatro caminos de arranque a la vez.
            //
            // El match por substring que vivía aquí ('microphone', 'permission')
            // era locale-dependiente: Windows traduce sus mensajes, así que
            // nunca disparaba en las máquinas en español del piloto. Este toast
            // queda sólo para lo que NO es un error de dispositivo.
            toast.error('Error al iniciar grabacion', {
              description: errorMsg,
              duration: 5000,
            });
          } finally {
            setIsAutoStarting(false);
            isStartingRef.current = false;
          }
        });
      } catch (error) {
        console.error('Failed to setup meeting detector listener:', error);
      }
    };

    setupMeetingDetectorListener();

    return () => subs.dispose();
  }, []);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      // Guard SÍNCRONO (ref), NO `isAutoStarting`.
      //
      // `isAutoStarting` es estado de React: `setIsAutoStarting(true)` no se ve
      // hasta el siguiente render, así que dos clics rápidos en el botón del
      // Sidebar disparaban dos veces este handler con el guard todavía en false.
      // Ambos llegaban al backend y el segundo chocaba contra StartGate::acquire()
      // ("Recording start already in progress") dejando la UI en ERROR mientras
      // el backend grababa de verdad. El estado de React no es un mutex.
      if (isRecording || isStartingRef.current) {
        logger.debug('Recording already in progress, ignoring direct start event');
        return;
      }
      isStartingRef.current = true;

      const provider = transcriptModelConfig?.provider || DEFAULT_TRANSCRIPTION_PROVIDER;
      logger.debug(`Direct start from sidebar - checking ${provider} transcription status`);
      setIsAutoStarting(true);

      try {
        const transcriptionStatus = await checkTranscriptionReady();
        if (!transcriptionStatus.ready) {
          handleTranscriptionNotReady(transcriptionStatus, 'sidebar_direct');
          return;
        }

        await startRecordingFlow('sidebar_direct');
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        recordingLogService.log('recording_start_failed', null, 'error', error instanceof Error ? error.message : String(error));
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording from sidebar');
        setIsRecording(false);
        Analytics.trackButtonClick('start_recording_error', 'sidebar_direct');
      } finally {
        setIsAutoStarting(false);
        isStartingRef.current = false;
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
    // `isAutoStarting` fuera de deps: el guard real es isStartingRef (síncrono),
    // así que re-suscribir el listener en cada cambio del transitorio solo
    // generaba churn de add/removeEventListener.
  }, [
    isRecording,
    checkTranscriptionReady,
    handleTranscriptionNotReady,
    startRecordingFlow,
    setStatus,
    setIsRecording,
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
          // Auto-reconexión: el monitor solo vigila los devices de la sesión,
          // así que el evento ya viene filtrado. Reusa switch_audio_device
          // (el mismo camino del modal flotante) para reabrir los streams con
          // el nombre RE-ENUMERADO que emite el monitor (Windows puede subir
          // el índice BT "(2- ...)" → "(3- ...)" al re-emparejar).
          let switched = false;
          if (event.device_name && event.device_type) {
            try {
              switched = await invoke<boolean>('switch_audio_device', {
                deviceName: event.device_name,
                deviceType: event.device_type,
              });
            } catch {
              switched = false;
            }
          }
          if (switched) {
            toast.success('Dispositivo reconectado', {
              description: `«${event.device_name}» reconectado — la grabación continúa con él.`,
              duration: 5000,
            });
          } else {
            toast.success('Dispositivo disponible de nuevo', {
              description: `${event.device_name || 'Dispositivo'} se reconectó. Puedes volver a elegirlo en el selector de dispositivos.`,
              duration: 6000,
            });
          }
        } else if (event.type === 'DeviceListChanged') {
          toast.info('Cambio en dispositivos de audio', {
            description: 'Se detecto un cambio en los dispositivos de audio disponibles.',
            duration: 4000,
          });
        }
      } catch {
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
