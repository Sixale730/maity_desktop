import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

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

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<RecordingLevels>('recording-audio-levels', (event) => {
        setLevels(event.payload);
      });
    };

    setup();
    return () => { unlisten?.(); };
  }, [isRecording]);

  return levels;
}
