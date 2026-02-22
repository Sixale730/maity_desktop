'use client';

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Play, Pause, Square, Mic, AlertCircle, X } from 'lucide-react';
import { ProcessRequest, ProcessSummaryResponse } from '@/types/summary';
import { listen } from '@tauri-apps/api/event';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Analytics from '@/lib/analytics';
import { useRecordingState } from '@/contexts/RecordingStateContext';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  audioLevels?: AudioLevels;
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: ProcessSummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  audioLevels,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;

  const [showPlayback, setShowPlayback] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const MIN_RECORDING_DURATION = 2000; // 2 seconds minimum recording time
  const [transcriptionErrors, setTranscriptionErrors] = useState(0);
  const [isValidatingModel, setIsValidatingModel] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string, message: string } | null>(null);

  const currentTime = 0;
  const duration = 0;
  const isPlaying = false;
  const progress = 0;

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        alert('Error al inicializar grabación. Por favor revisa la consola para más detalles.');
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel) return;
    console.log('Starting recording...');
    console.log('Selected devices:', selectedDevices);
    console.log('Meeting name:', meetingName);
    console.log('Current isRecording state:', isRecording);

    setShowPlayback(false);
    setTranscript(''); // Clear any previous transcript
    setSpeechDetected(false); // Reset speech detection on new recording

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Parse error message to provide user-friendly feedback
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for device-related errors
      if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
        setDeviceError({
          title: 'Micrófono No Disponible',
          message: 'No se puede acceder a tu micrófono. Por favor verifica que:\n• Tu micrófono esté conectado\n• La aplicación tenga permisos de micrófono\n• Ninguna otra aplicación esté usando el micrófono'
        });
      } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
        setDeviceError({
          title: 'Audio del Sistema No Disponible',
          message: 'No se puede capturar el audio del sistema. Por favor verifica que:\n• Un dispositivo de audio virtual (como BlackHole) esté instalado\n• La aplicación tenga permisos de grabación de pantalla (macOS)\n• El audio del sistema esté configurado correctamente'
        });
      } else if (errorMsg.includes('permission')) {
        setDeviceError({
          title: 'Permiso Requerido',
          message: 'Se requieren permisos de grabación. Por favor:\n• Otorga acceso al micrófono en Configuración del Sistema\n• Otorga acceso a grabación de pantalla para audio del sistema (macOS)\n• Reinicia la aplicación después de otorgar permisos'
        });
      } else {
        setDeviceError({
          title: 'Grabación Fallida',
          message: 'No se puede iniciar la grabación. Por favor verifica la configuración de tus dispositivos de audio e intenta de nuevo.'
        });
      }
    }
  }, [onRecordingStart, isStarting, isValidatingModel, selectedDevices, meetingName, isRecording]);

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');
      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', result);
      setRecordingPath(savePath);
      // setShowPlayback(true);
      setIsProcessing(false);
      // Track successful transcription
      Analytics.trackTranscriptionSuccess();
      onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'isStarting:', isStarting, 'isStopping:', isStopping);
    if (!isRecording || isStarting || isStopping) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    console.log('Stopping recording...');

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      alert('Error al pausar grabación. Por favor revisa la consola para más detalles.');
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      alert('Error al reanudar grabación. Por favor revisa la consola para más detalles.');
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          let errorMessage: string;
          let isActionable = false;

          if (typeof event.payload === 'object' && event.payload !== null) {
            const payload = event.payload as { error: string, userMessage: string, actionable: boolean };
            errorMessage = payload.userMessage || payload.error;
            isActionable = payload.actionable || false;
          } else {
            errorMessage = String(event.payload);
          }

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcription error');
          onRecordingStop(false);

          // For actionable errors (like model loading failures), the main page will handle showing the model selector
          // For regular errors, they are handled by useModalState global listener which shows a toast
          // We don't want to show a modal (via onTranscriptionError) AND a toast, so we skip the callback here
          /* if (onTranscriptionError && !isActionable) {
            onTranscriptionError(errorMessage);
          } */
        });

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        // Speech detected listener - for UX feedback when VAD detects speech
        const speechDetectedUnsubscribe = await listen('speech-detected', (event) => {
          console.log('speech-detected event received:', event);
          setSpeechDetected(true);
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 bg-white dark:bg-gray-900 rounded-full shadow-lg px-4 py-2">
          {isProcessing && !isParentProcessing ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900"></div>
              <span className="text-sm text-[#4a4a4c] dark:text-gray-300">Procesando grabación...</span>
            </div>
          ) : (
            <>
              {showPlayback ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="w-10 h-10 flex items-center justify-center bg-[#ff0050] rounded-full text-white hover:bg-[#cc0040] transition-colors"
                    aria-label="Nueva grabación"
                  >
                    <Mic size={16} />
                  </button>

                  <div className="w-px h-6 bg-[#d0d0d3] dark:bg-gray-600 mx-1" />

                  <div className="flex items-center space-x-1 mx-2">
                    <div className="text-sm text-[#4a4a4c] dark:text-gray-300 min-w-[40px]">
                      {formatTime(currentTime)}
                    </div>
                    <div
                      className="relative w-24 h-1 bg-[#d0d0d3] dark:bg-gray-600 rounded-full"
                    >
                      <div
                        className="absolute h-full bg-[#485df4] rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-sm text-[#4a4a4c] dark:text-gray-300 min-w-[40px]">
                      {formatTime(duration)}
                    </div>
                  </div>

                  <button
                    className="w-10 h-10 flex items-center justify-center bg-[#b0b0b3] rounded-full text-white cursor-not-allowed"
                    disabled
                    aria-label="Reproducir grabación"
                  >
                    <Play size={16} />
                  </button>
                </>
              ) : (
                <>
                  {!isRecording ? (
                    // Start recording button
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            Analytics.trackButtonClick('start_recording', 'recording_controls');
                            handleStartRecording();
                          }}
                          disabled={isStarting || isProcessing || isRecordingDisabled || isValidatingModel}
                          className={`w-12 h-12 flex items-center justify-center ${isStarting || isProcessing || isValidatingModel || isRecordingDisabled ? 'bg-[#8a8a8d]' : 'bg-[#ff0050] hover:bg-[#cc0040]'
                            } rounded-full text-white transition-colors relative`}
                          aria-label="Iniciar grabación"
                        >
                          {isValidatingModel ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          ) : (
                            <Mic size={20} />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Iniciar grabación</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    // Recording controls (pause/resume + stop)
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (isPaused) {
                                Analytics.trackButtonClick('resume_recording', 'recording_controls');
                                handleResumeRecording();
                              } else {
                                Analytics.trackButtonClick('pause_recording', 'recording_controls');
                                handlePauseRecording();
                              }
                            }}
                            disabled={isPausing || isResuming || isStopping}
                            className={`w-10 h-10 flex items-center justify-center ${isPausing || isResuming || isStopping
                              ? 'bg-[#d0d0d3] dark:bg-gray-600 border-2 border-[#d0d0d3] dark:border-gray-600 text-[#8a8a8d]'
                              : 'bg-white dark:bg-gray-800 border-2 border-[#d0d0d3] dark:border-gray-600 text-[#4a4a4c] dark:text-gray-300 hover:border-gray-400 hover:bg-[#f5f5f6] dark:hover:bg-gray-700'
                              } rounded-full transition-colors relative`}
                            aria-label={isPaused ? 'Reanudar grabación' : 'Pausar grabación'}
                          >
                            {isPaused ? <Play size={16} /> : <Pause size={16} />}
                            {(isPausing || isResuming) && (
                              <div className="absolute -top-8 text-[#4a4a4c] dark:text-gray-300 font-medium text-xs">
                                {isPausing ? 'Pausando...' : 'Reanudando...'}
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isPaused ? 'Reanudar grabación' : 'Pausar grabación'}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              Analytics.trackButtonClick('stop_recording', 'recording_controls');
                              handleStopRecording();
                            }}
                            disabled={isStopping || isPausing || isResuming}
                            className={`w-10 h-10 flex items-center justify-center ${isStopping || isPausing || isResuming ? 'bg-[#8a8a8d]' : 'bg-[#ff0050] hover:bg-[#cc0040]'
                              } rounded-full text-white transition-colors relative`}
                            aria-label="Detener grabación"
                          >
                            <Square size={16} />
                            {isStopping && (
                              <div className="absolute -top-8 text-[#4a4a4c] dark:text-gray-300 font-medium text-xs">
                                Deteniendo...
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Detener grabación</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}

                  {/* Dual-channel audio level bars — only visible while recording */}
                  {isRecording && (
                    <div className="flex items-center gap-3 mx-4">
                      {/* Mic (user) levels */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[#485df4]" title="Tú (micrófono)">🎤</span>
                        <div className="flex items-end space-x-[2px] h-6">
                          {[0, 1, 2].map((i) => {
                            const rms = audioLevels?.micRms ?? 0;
                            const scale = [0.7, 1.0, 0.8][i];
                            const h = !isPaused
                              ? Math.max(3, Math.min(24, rms * 200 * scale))
                              : 3;
                            return (
                              <div
                                key={`mic-${i}`}
                                className="w-[3px] rounded-full transition-all duration-100 bg-[#485df4]"
                                style={{ height: `${h}px`, opacity: isPaused ? 0.4 : 1 }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      {/* System (interlocutor) levels */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[#10b981]" title="Interlocutor (bocina)">🔊</span>
                        <div className="flex items-end space-x-[2px] h-6">
                          {[0, 1, 2].map((i) => {
                            const rms = audioLevels?.sysRms ?? 0;
                            const scale = [0.8, 1.0, 0.7][i];
                            const h = !isPaused
                              ? Math.max(3, Math.min(24, rms * 200 * scale))
                              : 3;
                            return (
                              <div
                                key={`sys-${i}`}
                                className="w-[3px] rounded-full transition-all duration-100 bg-[#10b981]"
                                style={{ height: `${h}px`, opacity: isPaused ? 0.4 : 1 }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Show validation status only */}
        {isValidatingModel && (
          <div className="text-xs text-[#4a4a4c] dark:text-gray-300 text-center mt-2">
            Validando reconocimiento de voz...
          </div>
        )}

        {/* Device error alert */}
        {deviceError && (
          <Alert variant="destructive" className="mt-4 border-[#ff80ad] dark:border-red-800 bg-[#fff0f5] dark:bg-red-900/30">
            <AlertCircle className="h-5 w-5 text-[#cc0040]" />
            <button
              onClick={() => setDeviceError(null)}
              className="absolute right-3 top-3 text-[#cc0040] hover:text-red-800 transition-colors"
              aria-label="Close alert"
            >
              <X className="h-4 w-4" />
            </button>
            <AlertTitle className="text-red-800 font-semibold mb-2">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-[#990030]">
              {deviceError.message.split('\n').map((line, i) => (
                <div key={i} className={i > 0 ? 'ml-2' : ''}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* {showPlayback && recordingPath && (
        <div className="text-sm text-[#4a4a4c] dark:text-gray-300 px-4">
          Recording saved to: {recordingPath}
        </div>
      )} */}
      </div>
    </TooltipProvider>
  );
};