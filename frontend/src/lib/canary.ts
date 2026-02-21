// Types for Canary (NVIDIA NeMo Canary-1B-Flash) integration
export interface CanaryModelInfo {
  name: string;
  path: string;
  size_mb: number;
  status: CanaryModelStatus;
  description?: string;
}

export type CanaryModelStatus =
  | 'Available'
  | 'Missing'
  | { Downloading: number }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_min_size: number } };

// User-friendly model display configuration
export interface CanaryModelDisplayInfo {
  friendlyName: string;
  icon: string;
  tagline: string;
  recommended?: boolean;
}

export const CANARY_MODEL_DISPLAY_CONFIG: Record<string, CanaryModelDisplayInfo> = {
  'canary-1b-flash-int8': {
    friendlyName: 'Canary Flash',
    icon: '🐦',
    tagline: 'Mejor precisión en español • 2.69% WER • Encoder-Decoder',
    recommended: true,
  },
};

export function getCanaryModelDisplayInfo(modelName: string): CanaryModelDisplayInfo | null {
  return CANARY_MODEL_DISPLAY_CONFIG[modelName] || null;
}

export function getCanaryModelDisplayName(modelName: string): string {
  const displayInfo = CANARY_MODEL_DISPLAY_CONFIG[modelName];
  return displayInfo?.friendlyName || modelName;
}

export function formatFileSize(sizeMb: number): string {
  if (sizeMb >= 1000) {
    return `${(sizeMb / 1000).toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

// Tauri command wrappers for Canary backend
import { invoke } from '@tauri-apps/api/core';

export class CanaryAPI {
  static async init(): Promise<void> {
    await invoke('canary_init');
  }

  static async getAvailableModels(): Promise<CanaryModelInfo[]> {
    return await invoke('canary_get_available_models');
  }

  static async loadModel(modelName: string): Promise<void> {
    await invoke('canary_load_model', { modelName });
  }

  static async getCurrentModel(): Promise<string | null> {
    return await invoke('canary_get_current_model');
  }

  static async isModelLoaded(): Promise<boolean> {
    return await invoke('canary_is_model_loaded');
  }

  static async transcribeAudio(audioData: number[]): Promise<string> {
    return await invoke('canary_transcribe_audio', { audioData });
  }

  static async downloadModel(modelName: string): Promise<void> {
    await invoke('canary_download_model', { modelName });
  }

  static async cancelDownload(modelName: string): Promise<void> {
    await invoke('canary_cancel_download', { modelName });
  }

  static async deleteModel(modelName: string): Promise<string> {
    return await invoke('canary_delete_model', { modelName });
  }

  static async validateModelReady(): Promise<string> {
    return await invoke('canary_validate_model_ready');
  }
}
