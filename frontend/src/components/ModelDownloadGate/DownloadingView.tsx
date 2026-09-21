import React from 'react';
import { Loader2 } from 'lucide-react';

interface DownloadingViewProps {
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  /**
   * Aun no llega el primer evento de progreso. Rust puede tardar hasta 30s antes del
   * primer byte (connect_timeout + descubrimiento de modelos), asi que este estado es
   * legitimo y no significa que algo fallo.
   */
  isConnecting?: boolean;
}

function formatMb(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export function DownloadingView({
  progress,
  downloadedMb,
  totalMb,
  speedMbps,
  isConnecting = false,
}: DownloadingViewProps) {
  const isVerifying = !isConnecting && progress >= 100;
  const safeProgress = Math.min(Math.max(progress, 0), 100);

  const label = isConnecting
    ? 'Conectando…'
    : isVerifying
    ? 'Verificando…'
    : 'Descargando modelo de transcripción…';

  return (
    <div className="flex flex-col items-center space-y-8">
      <div className="w-16 h-16 rounded-full bg-maity-blue/10  flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-maity-blue animate-spin" />
      </div>

      <div className="w-full max-w-md space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{label}</span>
          {!isConnecting && (
            <span className="text-maity-blue font-semibold">
              {Math.round(safeProgress)}%
            </span>
          )}
        </div>

        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="bg-maity-blue h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${isConnecting ? 0 : safeProgress}%` }}
          />
        </div>

        {!isConnecting && !isVerifying && totalMb > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatMb(downloadedMb)} / {formatMb(totalMb)}
            </span>
            {speedMbps > 0 && <span>{speedMbps.toFixed(1)} MB/s</span>}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Mantén la app abierta. Esto solo ocurre la primera vez. El modelo de análisis
        sigue descargándose en segundo plano; no necesitas esperarlo.
      </p>
    </div>
  );
}
