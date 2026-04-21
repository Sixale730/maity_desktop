'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParakeetAutoDownloadContext } from '@/contexts/ParakeetAutoDownloadContext';
import { ConsentView } from './ConsentView';
import { DownloadingView } from './DownloadingView';
import { ErrorView } from './ErrorView';
import { logger } from '@/lib/logger';

interface ModelDownloadGateProps {
  onComplete: () => void;
}

type GatePhase = 'consent' | 'downloading' | 'error';

export function ModelDownloadGate({ onComplete }: ModelDownloadGateProps) {
  const {
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
  } = useParakeetAutoDownloadContext();

  const [phase, setPhase] = useState<GatePhase>(isDownloading ? 'downloading' : 'consent');
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isModelReady) {
      logger.debug('[ModelDownloadGate] Model ready, dismissing gate');
      onComplete();
    }
  }, [isModelReady, onComplete]);

  useEffect(() => {
    if (error) {
      setPhase('error');
      setIsRetrying(false);
      return;
    }
    if (isDownloading) {
      setPhase('downloading');
    }
  }, [error, isDownloading]);

  const handleAccept = useCallback(async () => {
    setPhase('downloading');
    await startDownload();
  }, [startDownload]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setPhase('downloading');
    await retry();
  }, [retry]);

  const title =
    phase === 'consent'
      ? 'Descargar modelo de transcripción'
      : phase === 'downloading'
      ? 'Preparando tu modelo de transcripción'
      : 'Algo salió mal';

  const description =
    phase === 'consent'
      ? 'Maity necesita descargar un modelo local para transcribir tus reuniones sin enviar audio a la nube.'
      : phase === 'downloading'
      ? 'No cierres la app. Esto solo ocurre una vez.'
      : 'Necesitamos descargar el modelo para que puedas grabar.';

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-hidden">
      <div className="w-full max-w-2xl h-full max-h-screen flex flex-col px-6 py-6">
        <div className="mb-6 text-center space-y-3 flex-shrink-0">
          <h1 className="text-3xl md:text-4xl font-semibold text-[#000000] dark:text-white">
            {title}
          </h1>
          <p className="text-base text-[#4a4a4c] dark:text-gray-300 max-w-md mx-auto">
            {description}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 flex items-start justify-center pt-4">
          {phase === 'consent' && <ConsentView isOnline={isOnline} onAccept={handleAccept} />}
          {phase === 'downloading' && (
            <DownloadingView
              progress={downloadProgress}
              downloadedMb={downloadedMb}
              totalMb={totalMb}
              speedMbps={speedMbps}
            />
          )}
          {phase === 'error' && (
            <ErrorView
              error={error || 'Error desconocido'}
              onRetry={handleRetry}
              isRetrying={isRetrying}
            />
          )}
        </div>
      </div>
    </div>
  );
}
