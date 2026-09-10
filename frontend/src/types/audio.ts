export interface AudioDevice {
  name: string;
  device_type: 'Input' | 'Output';
}

export interface SelectedDevices {
  micDevice: string | null;
  systemDevice: string | null;
}

export interface AudioLevelData {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

export interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevelData[];
}

export interface BackendInfo {
  id: string;
  name: string;
  description: string;
}

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  /** Gain multiplier for system audio (0.5–3.0, default 1.5) */
  system_audio_gain?: number;
  /**
   * Días que se conserva el audio.mp4 de una reunión ya sincronizada y
   * analizada. 0 = nunca borrar. Opcional porque el estado inicial de
   * RecordingSettings se construye antes del primer get_recording_preferences;
   * Rust siempre lo devuelve (serde default = 30).
   */
  audio_retention_days?: number;
  /**
   * Modo de transcripción (F3/F4 de la migración a lote). `'streaming'` transcribe
   * mientras graba; `'batch'` graba sólo audio y el planner transcribe al cerrar
   * el segmento. Sin `auto_save` no hay checkpoints → Rust cae a streaming aunque
   * diga `'batch'` (`recording_helpers.rs`). Opcional por el mismo motivo que
   * `audio_retention_days`; Rust siempre lo devuelve. OJO: el default de serde
   * DEPENDE DEL BUILD (`recording_preferences.rs::default_transcription_mode`):
   * `'batch'` si se compiló con `MAITY_PILOT_BATCH=1` (build piloto), si no
   * `'streaming'`. Por eso `RecordingSettings` no debe escribir un objeto que no
   * salió de un `get_recording_preferences` exitoso: al faltar el campo,
   * `set_recording_preferences` (reemplazo entero) lo resetearía al default.
   */
  transcription_mode?: 'streaming' | 'batch';
}

// Subset of RecordingPreferences for device-only config
export interface DevicePreferences {
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

export interface LanguagePreference {
  language: string;
}
