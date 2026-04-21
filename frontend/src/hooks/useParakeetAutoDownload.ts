import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';

export interface ParakeetAutoDownloadState {
  isModelReady: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  error: string | null;
  refresh: () => Promise<boolean>;
  startDownload: () => Promise<void>;
  retry: () => Promise<void>;
}

const MODEL_NAME = 'parakeet-tdt-0.6b-v3-int8';

interface ModelStatusEntry {
  name?: string;
  status?: string | Record<string, unknown>;
}

function statusMatches(status: ModelStatusEntry['status'], key: string): boolean {
  if (!status) return false;
  if (typeof status === 'object') return key in status;
  return status === key;
}

export function useParakeetAutoDownload(): ParakeetAutoDownloadState {
  const [isModelReady, setIsModelReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedMb, setDownloadedMb] = useState(0);
  const [totalMb, setTotalMb] = useState(0);
  const [speedMbps, setSpeedMbps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      await invoke('parakeet_init');
      const hasModels = await invoke<boolean>('parakeet_has_available_models');
      setIsModelReady(hasModels);
      if (hasModels) {
        setIsDownloading(false);
        setError(null);
      }
      return hasModels;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('[ParakeetAutoDownload] refresh failed:', msg);
      return false;
    }
  }, []);

  const startDownload = useCallback(async () => {
    if (inFlightRef.current) {
      logger.debug('[ParakeetAutoDownload] startDownload ignored (already in flight)');
      return;
    }
    inFlightRef.current = true;
    try {
      await invoke('parakeet_init');

      const hasModels = await invoke<boolean>('parakeet_has_available_models');
      if (hasModels) {
        setIsModelReady(true);
        setIsDownloading(false);
        setError(null);
        return;
      }

      const models = await invoke<ModelStatusEntry[]>('parakeet_get_available_models');

      const alreadyDownloading = models.some(m => statusMatches(m.status, 'Downloading'));
      if (alreadyDownloading) {
        setIsDownloading(true);
        return;
      }

      const corrupted = models.find(m => m.name === MODEL_NAME && statusMatches(m.status, 'Corrupted'));
      if (corrupted) {
        logger.debug('[ParakeetAutoDownload] Corrupted model found, deleting before re-download');
        await invoke('parakeet_delete_corrupted_model', { modelName: MODEL_NAME });
      }

      logger.debug(`[ParakeetAutoDownload] Starting download of ${MODEL_NAME}`);
      setIsDownloading(true);
      setError(null);
      await invoke('parakeet_download_model', { modelName: MODEL_NAME });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[ParakeetAutoDownload] startDownload error:', errorMsg);
      setError(errorMsg);
      setIsDownloading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const retry = useCallback(async () => {
    setError(null);
    try {
      await invoke('parakeet_retry_download', { modelName: MODEL_NAME });
      setIsDownloading(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ParakeetAutoDownload] retry error:', msg);
      setError(msg);
    }
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const unProgress = await listen<{
        progress?: number;
        status?: string;
        downloaded_mb?: number;
        total_mb?: number;
        speed_mbps?: number;
      }>('parakeet-model-download-progress', (event) => {
        const { progress, status, downloaded_mb, total_mb, speed_mbps } = event.payload;
        if (status === 'cancelled') {
          setIsDownloading(false);
          return;
        }
        setDownloadProgress(progress ?? 0);
        setDownloadedMb(downloaded_mb ?? 0);
        setTotalMb(total_mb ?? 0);
        setSpeedMbps(speed_mbps ?? 0);
        setIsDownloading(true);
      });
      unlisteners.push(unProgress);

      const unComplete = await listen<void>('parakeet-model-download-complete', () => {
        logger.debug('[ParakeetAutoDownload] Download complete');
        setIsModelReady(true);
        setIsDownloading(false);
        setDownloadProgress(100);
        setError(null);
      });
      unlisteners.push(unComplete);

      const unError = await listen<{ error?: string }>('parakeet-model-download-error', (event) => {
        const errorMsg = event.payload?.error || 'Download failed';
        console.error('[ParakeetAutoDownload] Download error:', errorMsg);
        setError(errorMsg);
        setIsDownloading(false);
      });
      unlisteners.push(unError);
    };

    setup();

    return () => {
      unlisteners.forEach(fn => fn());
    };
  }, []);

  return {
    isModelReady,
    isDownloading,
    downloadProgress,
    downloadedMb,
    totalMb,
    speedMbps,
    error,
    refresh,
    startDownload,
    retry,
  };
}
