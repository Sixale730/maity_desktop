import React from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorViewProps {
  error: string;
  onRetry: () => void;
  isRetrying: boolean;
}

export function ErrorView({ error, onRetry, isRetrying }: ErrorViewProps) {
  return (
    <div className="flex flex-col items-center space-y-8">
      <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
      </div>

      <div className="w-full max-w-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
        <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
          No se pudo descargar el modelo
        </p>
        <p className="text-xs text-red-600 dark:text-red-400 break-words">{error}</p>
      </div>

      <div className="w-full max-w-xs">
        <Button
          onClick={onRetry}
          disabled={isRetrying}
          className="w-full h-11 bg-[#1bea9a] hover:bg-[#17d48b] text-gray-900 font-medium disabled:opacity-50"
        >
          <RotateCw className={`w-4 h-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
          {isRetrying ? 'Reintentando…' : 'Reintentar'}
        </Button>
      </div>

      <p className="text-xs text-[#8a8a8d] dark:text-gray-500 text-center max-w-xs">
        Verifica tu conexión a internet y vuelve a intentar.
      </p>
    </div>
  );
}
