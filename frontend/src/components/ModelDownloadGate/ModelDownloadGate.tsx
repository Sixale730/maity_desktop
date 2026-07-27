'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParakeetAutoDownloadContext } from '@/contexts/ParakeetAutoDownloadContext';
import { DownloadingView } from './DownloadingView';
import { ErrorView } from './ErrorView';
import { logger } from '@/lib/logger';

interface ModelDownloadGateProps {
  onComplete: () => void;
}

type GatePhase = 'connecting' | 'downloading' | 'error';

/**
 * Cuánto esperamos en "Conectando…" antes de ofrecer Reintentar.
 *
 * Tiene que ser > 30s: una descarga VIVA puede estar legítimamente muda ese tiempo
 * (connect_timeout de reqwest + descubrimiento de modelos + limpieza del directorio).
 * Si mostráramos el botón antes, lo ofreceríamos con la tarea de Rust todavía corriendo.
 * Aun así es seguro: `parakeet_retry_download` ahora no relanza si el modelo sigue en
 * `active_downloads`, así que un reintento a destiempo es un no-op, no un segundo writer.
 */
const CONNECTING_TIMEOUT_MS = 60_000;

/**
 * Gate bloqueante: espera a que el modelo de transcripción (Parakeet) esté en disco.
 *
 * Es PASIVO a propósito: no arranca ni cancela descargas, solo observa. Quien arranca
 * es `WelcomeStep` (cuentas nuevas) o `BackgroundDownloadStarter` (cuentas existentes),
 * montado fuera del ternario de ramas de `layout.tsx`, así que sigue corriendo mientras
 * este gate está montado. Esa pasividad es lo que evita que el gate cree una segunda
 * descarga compitiendo con la que ya existe.
 *
 * NO tiene botón de omitir: es una decisión de producto explícita. Si la descarga es
 * imposible (p.ej. una red corporativa que bloquee huggingface.co), la única salida es
 * cerrar sesión desde el badge de cuenta que monta `layout.tsx` junto a este gate.
 */
export function ModelDownloadGate({ onComplete }: ModelDownloadGateProps) {
  const {
    isModelReady,
    isDownloading,
    isRetrying,
    downloadProgress,
    downloadedMb,
    totalMb,
    speedMbps,
    error,
    refresh,
    retry,
  } = useParakeetAutoDownloadContext();

  const [phase, setPhase] = useState<GatePhase>(isDownloading ? 'downloading' : 'connecting');
  const [connectingTooLong, setConnectingTooLong] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Verificación inicial contra disco: si el modelo ya está, el efecto de abajo levanta
  // el gate sin que el usuario vea nada.
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

  // ORDEN OBLIGATORIO: `isModelReady` se evalúa ANTES que `isDownloading`.
  // Rust emite COMPLETE antes de que su comando retorne `Ok`, así que tras un reintento
  // exitoso `setIsDownloading(true)` puede correr DESPUÉS del complete. Si diéramos
  // prioridad a `isDownloading`, el gate no se levantaría nunca.
  useEffect(() => {
    if (isModelReady) {
      logger.debug('[ModelDownloadGate] Modelo listo, levantando el gate');
      onComplete();
    }
  }, [isModelReady, onComplete]);

  // `isDownloading` gana sobre `error`: si siguen llegando eventos de progreso, la
  // descarga está viva y un error rezagado no debe tumbar la pantalla.
  useEffect(() => {
    if (isDownloading) {
      setPhase('downloading');
      return;
    }
    if (error) {
      setPhase('error');
      return;
    }
    setPhase('connecting');
  }, [isDownloading, error]);

  // Red de seguridad para el estado "ni descargando, ni error, ni listo": sin esto el
  // gate se quedaría en "Conectando…" para siempre si el arranque falló en silencio.
  useEffect(() => {
    if (phase !== 'connecting') {
      setConnectingTooLong(false);
      return;
    }
    const timer = setTimeout(() => setConnectingTooLong(true), CONNECTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleRetry = useCallback(() => {
    setConnectingTooLong(false);
    void retry();
  }, [retry]);

  const showError = phase === 'error' || (phase === 'connecting' && connectingTooLong);

  const title = showError
    ? 'Algo salió mal'
    : 'Preparando tu modelo de transcripción';

  const description = showError
    ? 'Necesitamos descargar el modelo para que puedas grabar.'
    : 'No cierres la app. Esto solo ocurre una vez.';

  const errorMessage = !isOnline
    ? 'Sin conexión a internet.'
    : error || 'La descarga no arrancó. Revisa tu conexión a internet.';

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-hidden">
      <div className="w-full max-w-2xl h-full max-h-screen flex flex-col px-6 py-6">
        <div className="mb-6 text-center space-y-3 flex-shrink-0">
          <h1 className="text-3xl font-semibold text-[#000000] dark:text-white">{title}</h1>
          <p className="text-base text-[#4a4a4c] dark:text-gray-300 max-w-md mx-auto">
            {description}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 flex items-start justify-center pt-4">
          {showError ? (
            <ErrorView
              error={errorMessage}
              onRetry={handleRetry}
              isRetrying={isRetrying}
              title={phase === 'error' ? 'No se pudo descargar el modelo' : 'La descarga no avanzó'}
            />
          ) : (
            <DownloadingView
              progress={downloadProgress}
              downloadedMb={downloadedMb}
              totalMb={totalMb}
              speedMbps={speedMbps}
              isConnecting={phase === 'connecting'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
