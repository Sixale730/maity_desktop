import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface AudioLevelData {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevelData[];
}

interface PreviewLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

const ZERO: PreviewLevels = { micRms: 0, micPeak: 0, sysRms: 0, sysPeak: 0 };

/**
 * Monitors microphone audio levels when NOT recording (preview mode).
 * Starts CPAL-based monitoring via Tauri commands and listens for
 * 'audio-levels' events. Automatically stops when recording starts.
 */
export function usePreviewLevels(
  isRecording: boolean,
  micDevice: string | null,
) {
  const [levels, setLevels] = useState<PreviewLevels>(ZERO);

  useEffect(() => {
    // Don't monitor during recording — the pipeline handles levels
    if (isRecording) {
      setLevels(ZERO);
      return;
    }

    let unlisten: (() => void) | undefined;
    let active = true;

    const start = async () => {
      // Start CPAL monitoring for the selected (or default) mic
      const deviceNames = micDevice ? [micDevice] : [];
      try {
        await invoke('start_audio_level_monitoring', { deviceNames });
      } catch (err) {
        console.error('Failed to start preview monitoring:', err);
        return;
      }

      if (!active) return;

      // Listen for level events from the monitor
      unlisten = await listen<AudioLevelUpdate>('audio-levels', (event) => {
        const update = event.payload;
        if (update.levels.length > 0) {
          const mic = update.levels[0];
          setLevels({
            micRms: mic.rms_level,
            micPeak: mic.peak_level,
            sysRms: 0, // System audio only available during recording
            sysPeak: 0,
          });
        }
      });
    };

    start();

    return () => {
      active = false;
      unlisten?.();
      invoke('stop_audio_level_monitoring').catch(console.error);
      setLevels(ZERO);
    };
  }, [isRecording, micDevice]);

  return levels;
}
