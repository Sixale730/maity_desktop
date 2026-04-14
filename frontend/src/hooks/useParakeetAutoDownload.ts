import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';

interface ParakeetAutoDownloadState {
  isModelReady: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
}

const MODEL_NAME = 'parakeet-tdt-0.6b-v3-int8';
const RETRY_DELAY_MS = 30_000;

export function useParakeetAutoDownload(): ParakeetAutoDownloadState {
  const { isAuthenticated, maityUser } = useAuth();
  const [isModelReady, setIsModelReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasTriggered = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAndDownload = useCallback(async () => {
    try {
      // Initialize engine (idempotent)
      await invoke('parakeet_init');

      // Check if model is already available
      const hasModels = await invoke<boolean>('parakeet_has_available_models');
      if (hasModels) {
        logger.debug('[ParakeetAutoDownload] Model already available');
        setIsModelReady(true);
        setIsDownloading(false);
        setError(null);
        return;
      }

      // Check if a download is already in progress
      const models = await invoke<{ name?: string; status?: string | Record<string, unknown> }[]>('parakeet_get_available_models');
      const alreadyDownloading = models.some(m =>
        m.status && (
          typeof m.status === 'object'
            ? 'Downloading' in m.status
            : m.status === 'Downloading'
        )
      );

      if (alreadyDownloading) {
        logger.debug('[ParakeetAutoDownload] Download already in progress');
        setIsDownloading(true);
        return;
      }

      // Check if model is corrupted and needs deletion first
      const corruptedModel = models.find(m =>
        m.name === MODEL_NAME && m.status && (
          typeof m.status === 'object'
            ? 'Corrupted' in m.status
            : m.status === 'Corrupted'
        )
      );

      if (corruptedModel) {
        logger.debug('[ParakeetAutoDownload] Corrupted model found, deleting before re-download');
        await invoke('parakeet_delete_corrupted_model', { modelName: MODEL_NAME });
      }

      // Start download
      logger.debug(`[ParakeetAutoDownload] Starting download of ${MODEL_NAME}`);
      setIsDownloading(true);
      setError(null);
      await invoke('parakeet_download_model', { modelName: MODEL_NAME });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[ParakeetAutoDownload] Error:', errorMsg);
      setError(errorMsg);
      setIsDownloading(false);

      // Schedule retry
      retryTimeoutRef.current = setTimeout(() => {
        logger.debug('[ParakeetAutoDownload] Retrying after error...');
        setError(null);
        checkAndDownload();
      }, RETRY_DELAY_MS);
    }
  }, []);

  // Listen for download events
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const unProgress = await listen<{ progress?: number; status?: string }>('parakeet-model-download-progress', (event) => {
        const { progress, status } = event.payload;
        if (status === 'cancelled') {
          setIsDownloading(false);
          return;
        }
        setDownloadProgress(progress ?? 0);
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

        // Schedule retry
        retryTimeoutRef.current = setTimeout(() => {
          logger.debug('[ParakeetAutoDownload] Retrying after download error...');
          setError(null);
          checkAndDownload();
        }, RETRY_DELAY_MS);
      });
      unlisteners.push(unError);
    };

    setup();

    return () => {
      unlisteners.forEach(fn => fn());
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [checkAndDownload]);

  // Trigger auto-download after authentication
  useEffect(() => {
    if (!isAuthenticated || !maityUser || hasTriggered.current) return;
    hasTriggered.current = true;
    checkAndDownload();
  }, [isAuthenticated, maityUser, checkAndDownload]);

  return { isModelReady, isDownloading, downloadProgress, error };
}
