'use client';

import { useTranscriptionLag } from '@/hooks/useTranscriptionLag';
import { useRecordingState } from '@/contexts/RecordingStateContext';

/**
 * TranscriptionLagIndicator
 *
 * Shows real-time transcription lag status during active recording.
 * - Green (lag < 5s): "En vivo" with green dot
 * - Yellow (lag 5-15s): "Transcripcion ~Xs atras" with yellow styling
 * - Red (lag > 15s): "Transcripcion ~Xs atras" with red pulsing styling
 */
export function TranscriptionLagIndicator() {
  const { isRecording } = useRecordingState();
  const { lagSeconds, isActive } = useTranscriptionLag(isRecording);

  // Don't render if not recording or no lag data received yet
  if (!isRecording || !isActive) return null;

  const roundedLag = Math.round(lagSeconds);

  // Green: lag < 5s
  if (roundedLag < 5) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          En vivo
        </span>
      </div>
    );
  }

  // Yellow: lag 5-15s
  if (roundedLag <= 15) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          ~{roundedLag}s atras
        </span>
      </div>
    );
  }

  // Red: lag > 15s
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 dark:bg-red-950/30">
      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-[11px] font-medium text-red-700 dark:text-red-400">
        ~{roundedLag}s atras
      </span>
    </div>
  );
}
