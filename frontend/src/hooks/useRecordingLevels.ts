import { useState, useEffect } from 'react';
import { subscribeTauriEvent } from '@/lib/tauriSubscribe';
import { TauriEvent } from '@/lib/tauri-events';

interface RecordingLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

const ZERO_LEVELS: RecordingLevels = { micRms: 0, micPeak: 0, sysRms: 0, sysPeak: 0 };

export function useRecordingLevels(isRecording: boolean) {
  const [levels, setLevels] = useState<RecordingLevels>(ZERO_LEVELS);

  useEffect(() => {
    if (!isRecording) {
      setLevels(ZERO_LEVELS);
      return;
    }

    return subscribeTauriEvent<RecordingLevels>(TauriEvent.RECORDING_AUDIO_LEVELS, (event) => {
      setLevels(event.payload);
    });
  }, [isRecording]);

  return levels;
}
