'use client';

/**
 * TranscriptionProgressBar
 *
 * Shown when recording stops and transcription is still catching up.
 * Displays a progress bar with estimated time remaining and a skip button.
 * Replaces the generic "Finalizando transcripcion..." spinner when progress data is available.
 */

interface TranscriptionProgressBarProps {
  totalRemaining: number;
  processed: number;
  estimatedSeconds: number;
  onCancel: () => void;
}

export function TranscriptionProgressBar({
  totalRemaining,
  processed,
  estimatedSeconds,
  onCancel,
}: TranscriptionProgressBarProps) {
  const total = totalRemaining + processed;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const roundedEta = Math.ceil(estimatedSeconds);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg px-5 py-3 flex flex-col gap-2 min-w-[320px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-[#485df4]" />
          <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
            Finalizando transcripcion...
          </span>
        </div>
        <button
          onClick={onCancel}
          className="text-xs text-[#8a8a8d] hover:text-[#4a4a4c] dark:text-gray-500 dark:hover:text-gray-300 transition-colors px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Omitir
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#485df4] rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[11px] text-[#8a8a8d] dark:text-gray-500">
        <span>{processed} / {total} segmentos</span>
        {roundedEta > 0 && <span>~{roundedEta}s restantes</span>}
      </div>
    </div>
  );
}
