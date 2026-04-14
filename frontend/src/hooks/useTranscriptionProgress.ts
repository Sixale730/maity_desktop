import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface TranscriptionFinishingData {
  total_remaining: number;
  processed: number;
  estimated_seconds: number;
}

export interface UseTranscriptionProgressResult {
  isFinishing: boolean;
  totalRemaining: number;
  processed: number;
  estimatedSeconds: number;
  isComplete: boolean;
  cancelPending: () => Promise<void>;
}

const _INITIAL_STATE: UseTranscriptionProgressResult = {
  isFinishing: false,
  totalRemaining: 0,
  processed: 0,
  estimatedSeconds: 0,
  isComplete: false,
  cancelPending: async () => {},
};

export function useTranscriptionProgress(): UseTranscriptionProgressResult {
  const [isFinishing, setIsFinishing] = useState(false);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  const cancelPending = useCallback(async () => {
    try {
      await invoke('cancel_pending_transcription');
      setIsFinishing(false);
      setIsComplete(true);
    } catch (error) {
      console.error('[TranscriptionProgress] Failed to cancel pending transcription:', error);
    }
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // Listen for finishing progress updates
      const unlistenFinishing = await listen<TranscriptionFinishingData>(
        'transcription-finishing',
        (event) => {
          const { total_remaining, processed: proc, estimated_seconds } = event.payload;
          setIsFinishing(true);
          setIsComplete(false);
          setTotalRemaining(total_remaining);
          setProcessed(proc);
          setEstimatedSeconds(estimated_seconds);
        }
      );
      unlisteners.push(unlistenFinishing);

      // Listen for transcription complete
      const unlistenComplete = await listen<void>('transcription-complete', () => {
        setIsFinishing(false);
        setIsComplete(true);
      });
      unlisteners.push(unlistenComplete);
    };

    setup();
    return () => { unlisteners.forEach(u => u()); };
  }, []);

  return {
    isFinishing,
    totalRemaining,
    processed,
    estimatedSeconds,
    isComplete,
    cancelPending,
  };
}
