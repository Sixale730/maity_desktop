import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import { TauriEvent } from '@/lib/tauri-events';

export interface ParakeetAutoDownloadState {
  isModelReady: boolean;
  isDownloading: boolean;
  /** Hay un reintento en vuelo: usar para deshabilitar el boton y evitar dobles clics. */
  isRetrying: boolean;
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

/**
 * "Download already in progress" NO es un error real: significa que otra invocacion
 * ya esta bajando el modelo y sus eventos de progreso van a llegar igual. Rust lo
 * emite como error igual que cualquier otro `Err` (commands.rs), asi que si no lo
 * filtramos aqui una UI bloqueante mostraria "algo salio mal" con la descarga sana.
 */
function isBenignAlreadyRunning(message: string): boolean {
  return /already in progress/i.test(message);
}

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
  const [isRetrying, setIsRetrying] = useState(false);
  const inFlightRef = useRef(false);
  const retryInFlightRef = useRef(false);

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
      if (isBenignAlreadyRunning(errorMsg)) {
        logger.debug('[ParakeetAutoDownload] ya habia una descarga viva, sigo sus eventos');
        setIsDownloading(true);
        return;
      }
      console.error('[ParakeetAutoDownload] startDownload error:', errorMsg);
      setError(errorMsg);
      setIsDownloading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const retry = useCallback(async () => {
    // Sin este guard, un doble clic lanzaba dos reintentos: el boton no se deshabilita
    // solo porque `parakeet_retry_download` no resuelve hasta terminar los ~600 MB.
    if (retryInFlightRef.current) {
      logger.debug('[ParakeetAutoDownload] retry ignorado (ya hay uno en vuelo)');
      return;
    }
    retryInFlightRef.current = true;
    setIsRetrying(true);
    setError(null);
    // ANTES del await, no despues: el invoke no resuelve hasta que la descarga TERMINA,
    // asi que marcarlo despues dejaba una ventana ciega (isDownloading=false, error=null)
    // durante toda la descarga, con la tarea de Rust ya viva.
    setIsDownloading(true);
    try {
      await invoke('parakeet_retry_download', { modelName: MODEL_NAME });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isBenignAlreadyRunning(msg)) {
        logger.debug('[ParakeetAutoDownload] retry: ya habia una descarga viva');
        return;
      }
      console.error('[ParakeetAutoDownload] retry error:', msg);
      setError(msg);
      setIsDownloading(false);
    } finally {
      retryInFlightRef.current = false;
      setIsRetrying(false);
    }
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // Todos los listeners filtran por modelName: el bus de eventos es global y una
      // descarga de otro modelo (p.ej. el v2 lanzado desde Ajustes) contaminaba el
      // estado de este hook, que solo observa MODEL_NAME.
      const isOtherModel = (name?: string) => Boolean(name) && name !== MODEL_NAME;

      const unProgress = await listen<{
        modelName?: string;
        progress?: number;
        status?: string;
        downloaded_mb?: number;
        total_mb?: number;
        speed_mbps?: number;
      }>(TauriEvent.PARAKEET_MODEL_DOWNLOAD_PROGRESS, (event) => {
        const { modelName, progress, status, downloaded_mb, total_mb, speed_mbps } = event.payload;
        if (isOtherModel(modelName)) return;
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

      const unComplete = await listen<{ modelName?: string }>(
        TauriEvent.PARAKEET_MODEL_DOWNLOAD_COMPLETE,
        (event) => {
          if (isOtherModel(event.payload?.modelName)) return;
          logger.debug('[ParakeetAutoDownload] Download complete');
          setIsModelReady(true);
          setIsDownloading(false);
          setDownloadProgress(100);
          setError(null);
        },
      );
      unlisteners.push(unComplete);

      const unError = await listen<{ modelName?: string; error?: string }>(
        TauriEvent.PARAKEET_MODEL_DOWNLOAD_ERROR,
        (event) => {
          if (isOtherModel(event.payload?.modelName)) return;
          const errorMsg = event.payload?.error || 'Download failed';
          if (isBenignAlreadyRunning(errorMsg)) {
            logger.debug('[ParakeetAutoDownload] evento "already in progress" ignorado');
            return;
          }
          console.error('[ParakeetAutoDownload] Download error:', errorMsg);
          setError(errorMsg);
          setIsDownloading(false);
        },
      );
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
    isRetrying,
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
