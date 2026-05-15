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
 * Monitors microphone AND system audio levels when NOT recording (preview mode).
 *
 * Iter 11: el monitor de niveles ahora arranca DOS streams en paralelo —
 * input (mic via CPAL) y output (sistema via WASAPI loopback en Windows /
 * CoreAudio en macOS / graceful-fail en Linux). El evento 'audio-levels'
 * incluye ambos device_types y este hook los splittea por su tipo.
 *
 * Antes (iter 10): sysRms hardcoded a 0 porque solo se leía mic; la barra
 * verde de RecordingControls quedaba plana en idle aunque hubiera audio del
 * sistema (YouTube/Spotify). Ahora se anima.
 *
 * Auto-stop al empezar grabación: la pipeline real toma el relevo emitiendo
 * 'recording-audio-levels' (no este evento), así que desmontamos el monitor
 * para evitar dobles instancias compitiendo por el loopback.
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

      // Listen for level events from the monitor.
      // Iter 11: el payload ahora incluye DOS levels — input (mic) y output
      // (sistema vía WASAPI loopback / CoreAudio). Filtrar por device_type
      // para popular ambos canales correctamente.
      unlisten = await listen<AudioLevelUpdate>('audio-levels', (event) => {
        const update = event.payload;
        const inputLvl = update.levels.find((l) => l.device_type === 'input');
        const outputLvl = update.levels.find((l) => l.device_type === 'output');
        setLevels({
          micRms: inputLvl?.rms_level ?? 0,
          micPeak: inputLvl?.peak_level ?? 0,
          sysRms: outputLvl?.rms_level ?? 0,
          sysPeak: outputLvl?.peak_level ?? 0,
        });
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
