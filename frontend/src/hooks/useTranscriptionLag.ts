import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export interface TranscriptionLagData {
  queue_depth: number;
  lag_seconds: number;
  chunks_per_second: number;
}

export interface UseTranscriptionLagResult {
  lagSeconds: number;
  queueDepth: number;
  chunksPerSecond: number;
  isActive: boolean;
}

const INITIAL_STATE: UseTranscriptionLagResult = {
  lagSeconds: 0,
  queueDepth: 0,
  chunksPerSecond: 0,
  isActive: false,
};

export function useTranscriptionLag(isRecording: boolean): UseTranscriptionLagResult {
  const [state, setState] = useState<UseTranscriptionLagResult>(INITIAL_STATE);

  useEffect(() => {
    if (!isRecording) {
      setState(INITIAL_STATE);
      return;
    }

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<TranscriptionLagData>('transcription-lag-update', (event) => {
        const { queue_depth, lag_seconds, chunks_per_second } = event.payload;
        setState({
          lagSeconds: lag_seconds,
          queueDepth: queue_depth,
          chunksPerSecond: chunks_per_second,
          isActive: true,
        });
      });
    };

    setup();
    return () => { unlisten?.(); };
  }, [isRecording]);

  return state;
}
