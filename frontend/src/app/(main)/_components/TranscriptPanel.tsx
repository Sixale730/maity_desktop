import { VirtualizedTranscriptView } from '@/components/transcript/VirtualizedTranscriptView';
import { RecordingStatusBar } from '@/components/recording/RecordingStatusBar';
import { PermissionWarning } from '@/components/recording/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused, transcriptionMode } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Lote (F4): mientras se graba NO hay transcripción en vivo. Sin este estado
  // el panel diría "Escuchando... Habla para ver la transcripción" durante toda
  // la sesión — el usuario creería que el micrófono no funciona.
  const isBatchLive = isRecording && transcriptionMode === 'batch';

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      source_type: t.source_type,
    })),
    [transcripts]
  );

  return (
    <div ref={transcriptContainerRef} className="w-full border-r border-border bg-background flex flex-col overflow-y-auto">
      {/* Title area - Sticky header */}
      <div className="sticky top-0 z-10 bg-background p-4 border-border">
        <div className="flex flex-col space-y-3">
          <div className="flex  flex-col space-y-2">
            <div className="flex justify-center  items-center space-x-2">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copiar Transcripción"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      Copiar
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="Idioma"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      Idioma
                    </span>
                  </Button>
                }
              </ButtonGroup>
            </div>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className="pb-20">
        <div className="flex justify-center">
          <div className="w-2/3 max-w-[750px]">
            {isBatchLive ? (
              <div className="flex flex-col h-full px-4 py-2" data-testid="batch-live-empty-state">
                <div className="sticky top-0 z-10 bg-background pb-2">
                  <RecordingStatusBar isPaused={isPaused} />
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground animate-fade-in py-12">
                  <div className={`w-3 h-3 rounded-full mb-3 ${isPaused ? 'bg-[#ff4080]' : 'bg-[#485df4] animate-pulse'}`} />
                  <p className="text-sm text-muted-foreground">
                    {isPaused ? 'Grabación pausada' : 'Transcribiendo al finalizar la grabación'}
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground/70">
                    {isPaused
                      ? 'Haz clic en reanudar para continuar; el texto se genera al terminar'
                      : 'El audio se está guardando; el texto llegará a Conversaciones al terminar'}
                  </p>
                </div>
              </div>
            ) : (
              <VirtualizedTranscriptView
                segments={segments}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                enableStreaming={isRecording}
                showConfidence={true}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
