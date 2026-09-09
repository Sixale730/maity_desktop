import { TranscriptionProgressBar } from '@/components/recording/TranscriptionProgressBar';
import { useTranscriptionProgress } from '@/hooks/useTranscriptionProgress';

interface StatusOverlaysProps {
  // Status flags
  isProcessing: boolean;      // Processing transcription after recording stops
  isSaving: boolean;          // Saving transcript to database

  // Layout
  sidebarCollapsed: boolean;  // For responsive margin calculation
}

// Internal reusable component for individual status overlays
interface StatusOverlayProps {
  show: boolean;
  message: string;
  sidebarCollapsed: boolean;
}

function StatusOverlay({ show, message, sidebarCollapsed }: StatusOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-0 right-0 z-10">
      <div
        className="flex justify-center pl-8 transition-[margin] duration-300"
        style={{
          marginLeft: sidebarCollapsed ? '4rem' : '16rem'
        }}
      >
        <div className="w-2/3 max-w-[750px] flex justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg px-4 py-2 flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#000000] dark:border-white"></div>
            <span className="text-sm text-[#3a3a3c] dark:text-gray-200">{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Main exported component - renders multiple status overlays
export function StatusOverlays({
  isProcessing,
  isSaving,
  sidebarCollapsed
}: StatusOverlaysProps) {
  const { isFinishing, totalRemaining, processed, estimatedSeconds, cancelPending } =
    useTranscriptionProgress();

  return (
    <>
      {/* Overlay de procesamiento - mostrado después de detener grabación mientras finaliza transcripción */}
      {/* When transcription-finishing events are available, show detailed progress bar instead of generic spinner */}
      {isProcessing && (
        isFinishing ? (
          <div className="fixed bottom-4 left-0 right-0 z-10">
            <div
              className="flex justify-center pl-8 transition-[margin] duration-300"
              style={{
                marginLeft: sidebarCollapsed ? '4rem' : '16rem'
              }}
            >
              <div className="w-2/3 max-w-[750px] flex justify-center">
                <TranscriptionProgressBar
                  totalRemaining={totalRemaining}
                  processed={processed}
                  estimatedSeconds={estimatedSeconds}
                  onCancel={cancelPending}
                />
              </div>
            </div>
          </div>
        ) : (
          <StatusOverlay
            show={true}
            message="Finalizando transcripción..."
            sidebarCollapsed={sidebarCollapsed}
          />
        )
      )}

      {/* Overlay de guardado - mostrado mientras guarda transcripción en base de datos */}
      <StatusOverlay
        show={isSaving}
        message="Guardando transcripción..."
        sidebarCollapsed={sidebarCollapsed}
      />
    </>
  );
}
