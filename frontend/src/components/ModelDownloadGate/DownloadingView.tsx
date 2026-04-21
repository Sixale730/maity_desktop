import React from 'react';
import { Loader2 } from 'lucide-react';

interface DownloadingViewProps {
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

function formatMb(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export function DownloadingView({ progress, downloadedMb, totalMb, speedMbps }: DownloadingViewProps) {
  const isVerifying = progress >= 100;
  const safeProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <div className="flex flex-col items-center space-y-8">
      <div className="w-16 h-16 rounded-full bg-[#f0f2fe] dark:bg-violet-950/40 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#3a4ac3] dark:text-violet-300 animate-spin" />
      </div>

      <div className="w-full max-w-md space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-[#000000] dark:text-white">
            {isVerifying ? 'Verificando…' : 'Descargando modelo de transcripción…'}
          </span>
          <span className="text-[#3a4ac3] dark:text-violet-300 font-semibold">
            {Math.round(safeProgress)}%
          </span>
        </div>

        <div className="w-full bg-[#e7e7e9] dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-[#3a4ac3] dark:bg-violet-400 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${safeProgress}%` }}
          />
        </div>

        {!isVerifying && totalMb > 0 && (
          <div className="flex items-center justify-between text-xs text-[#6a6a6d] dark:text-gray-400">
            <span>
              {formatMb(downloadedMb)} / {formatMb(totalMb)}
            </span>
            {speedMbps > 0 && <span>{speedMbps.toFixed(1)} MB/s</span>}
          </div>
        )}
      </div>

      <p className="text-xs text-[#8a8a8d] dark:text-gray-500 text-center max-w-xs">
        Mantén la app abierta. Esto solo ocurre la primera vez.
      </p>
    </div>
  );
}
