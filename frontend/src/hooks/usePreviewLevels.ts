import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TauriEvent } from '@/lib/tauri-events';

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
  mic_monitoring?: boolean;
}

interface MonitorStartResult {
  micActive: boolean;
  sysActive: boolean;
}

interface PreviewLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
  /** Si el stream de micrófono está realmente abierto (ver nota de Bluetooth). */
  micMonitoring: boolean;
}

const ZERO: PreviewLevels = {
  micRms: 0,
  micPeak: 0,
  sysRms: 0,
  sysPeak: 0,
  micMonitoring: false,
};

/**
 * Identificador único POR CORRIDA del efecto, no por instancia del hook.
 *
 * Es deliberado: al cambiar de micrófono, la corrida que se desmonta y la que
 * arranca conviven un instante. Con un id por instancia, el registro de Rust
 * las fusionaría (mismo owner) y el `stop` de la vieja apagaría a la nueva.
 */
let runCounter = 0;

/**
 * Monitors microphone AND system audio levels when NOT recording (preview mode).
 *
 * Iter 11: el monitor de niveles arranca DOS streams en paralelo — input (mic
 * via CPAL) y output (sistema via WASAPI loopback en Windows / CoreAudio en
 * macOS / graceful-fail en Linux). El evento 'audio-levels' incluye ambos
 * device_types y este hook los splittea por su tipo.
 *
 * BLUETOOTH (ago-2026): el stream de micrófono puede NO abrirse aunque se pida.
 * Con audífonos Bluetooth, abrir el endpoint de captura obliga a Windows a
 * conmutarlos de A2DP (estéreo) a manos libres (mono, 16 kHz) y degrada la
 * música del usuario — inaceptable sólo para animar unas barritas sin estar
 * grabando. La decisión la toma Rust (`audio::bluetooth_guard`), NO este hook:
 * duplicar la heurística en TypeScript fue justamente lo que falló antes (los
 * nombres mienten; el usuario puede renombrar sus audífonos). `micMonitoring`
 * refleja el resultado para que la UI atenúe las barras en vez de mostrarlas
 * planas como si el micrófono estuviera roto. El preview del SISTEMA sigue
 * vivo: es captura del lado de reproducción y no toca el micrófono.
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

    const ownerId = `preview:${++runCounter}`;
    let unlisten: (() => void) | undefined;
    let active = true;

    // Start CPAL monitoring for the selected (or default) mic
    const deviceNames = micDevice ? [micDevice] : [];
    const startPromise = invoke<MonitorStartResult>('start_audio_level_monitoring', {
      ownerId,
      deviceNames,
      wantMic: true,
    });

    const start = async () => {
      let result: MonitorStartResult;
      try {
        result = await startPromise;
      } catch (err) {
        console.error('Failed to start preview monitoring:', err);
        return;
      }

      if (!active) return;

      // Sembrar el estado con la respuesta del comando en vez de esperar al
      // primer evento: evita un frame con las barras "encendidas" en falso.
      setLevels((prev) => ({ ...prev, micMonitoring: result.micActive }));

      // Listen for level events from the monitor.
      // Iter 11: el payload ahora incluye DOS levels — input (mic) y output
      // (sistema vía WASAPI loopback / CoreAudio). Filtrar por device_type
      // para popular ambos canales correctamente.
      unlisten = await listen<AudioLevelUpdate>(TauriEvent.AUDIO_LEVELS, (event) => {
        const update = event.payload;
        const inputLvl = update.levels.find((l) => l.device_type === 'input');
        const outputLvl = update.levels.find((l) => l.device_type === 'output');
        setLevels({
          micRms: inputLvl?.rms_level ?? 0,
          micPeak: inputLvl?.peak_level ?? 0,
          sysRms: outputLvl?.rms_level ?? 0,
          sysPeak: outputLvl?.peak_level ?? 0,
          micMonitoring: update.mic_monitoring ?? false,
        });
      });
    };

    start();

    return () => {
      active = false;
      unlisten?.();
      // El `stop` se encadena al `start`: son comandos concurrentes y sin esto
      // el stop podía llegar primero, quedar en no-op, y dejar el micrófono
      // abierto sin nadie que pudiera cerrarlo. Rust tiene además su propia
      // defensa (tombstones por owner); esto evita el ida y vuelta inútil.
      startPromise
        .catch(() => {})
        .finally(() => {
          invoke('stop_audio_level_monitoring', { ownerId }).catch(console.error);
        });
      setLevels(ZERO);
    };
  }, [isRecording, micDevice]);

  return levels;
}
