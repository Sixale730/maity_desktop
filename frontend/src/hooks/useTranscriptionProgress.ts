import { useState, useEffect, useCallback } from 'react';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';
import { invoke } from '@tauri-apps/api/core';
import { TauriEvent } from '@/lib/tauri-events';

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
    const subs = createSubscriptionGroup();

    const setup = async () => {
      // Listen for finishing progress updates
      subs.on<TranscriptionFinishingData>(
        TauriEvent.TRANSCRIPTION_FINISHING,
        (event) => {
          const { total_remaining, processed: proc, estimated_seconds } = event.payload;
          setIsFinishing(true);
          setIsComplete(false);
          setTotalRemaining(total_remaining);
          setProcessed(proc);
          setEstimatedSeconds(estimated_seconds);
        }
      );

      // Listen for transcription complete
      subs.on<void>(TauriEvent.TRANSCRIPTION_COMPLETE, () => {
        setIsFinishing(false);
        setIsComplete(true);
      });
    };

    setup();
    return () => subs.dispose();
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
