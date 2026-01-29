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
}

// Subset of RecordingPreferences for device-only config
export interface DevicePreferences {
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

export interface LanguagePreference {
  language: string;
}
