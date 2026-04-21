import React from 'react';
import { Download, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConsentViewProps {
  isOnline: boolean;
  onAccept: () => void;
}

export function ConsentView({ isOnline, onAccept }: ConsentViewProps) {
  return (
    <div className="flex flex-col items-center space-y-8">
      <div className="w-16 h-16 rounded-full bg-[#f0f2fe] dark:bg-violet-950/40 flex items-center justify-center">
        <Download className="w-8 h-8 text-[#3a4ac3] dark:text-violet-300" />
      </div>

      <div className="w-full max-w-md bg-white dark:bg-gray-800/50 rounded-xl border border-[#e7e7e9] dark:border-gray-700 shadow-sm p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f5f6] dark:bg-gray-700 flex items-center justify-center">
            <span className="text-base">🎙️</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-[#000000] dark:text-white">
              Modelo de transcripción local
            </p>
            <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-0.5">
              parakeet-tdt-0.6b-v3-int8 · ~600 MB · Solo primera vez
            </p>
          </div>
        </div>
      </div>

      <div className="w-full max-w-md bg-[#f5f5f6] dark:bg-gray-800/30 rounded-lg p-4 flex items-start gap-3">
        <Wifi className="w-4 h-4 text-[#4a4a4c] dark:text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-[#4a4a4c] dark:text-gray-300 leading-relaxed">
          Se recomienda usar Wi-Fi. La descarga puede tardar varios minutos según
          tu conexión. Una vez instalado funciona sin internet.
        </p>
      </div>

      {!isOnline && (
        <div className="w-full max-w-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4 flex items-start gap-3">
          <WifiOff className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">
            Se requiere conexión a internet para descargar el modelo. Conéctate a
            una red e intenta de nuevo.
          </p>
        </div>
      )}

      <div className="w-full max-w-xs">
        <Button
          onClick={onAccept}
          disabled={!isOnline}
          className="w-full h-11 bg-[#1bea9a] hover:bg-[#17d48b] text-gray-900 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Descargar ahora (~600 MB)
        </Button>
      </div>
    </div>
  );
}
