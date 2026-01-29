import React from 'react';
import type { ChunkStatus, ProcessingProgress } from '@/types/transcript';

export type { ChunkStatus, ProcessingProgress };

interface ChunkProgressDisplayProps {
  progress: ProcessingProgress;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  isPaused?: boolean;
  className?: string;
}

export function ChunkProgressDisplay({
  progress,
  onPause,
  onResume,
  onCancel,
  isPaused = false,
  className = ''
}: ChunkProgressDisplayProps) {
  const completionPercentage = progress.total_chunks > 0
    ? Math.round((progress.completed_chunks / progress.total_chunks) * 100)
    : 0;

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatTimeRemaining = (ms?: number) => {
    if (!ms || ms <= 0) return 'Calculando...';
    return formatDuration(ms);
  };

  const getChunkStatusIcon = (status: ChunkStatus['status']) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'processing':
        return '⚡';
      case 'failed':
        return '❌';
      case 'pending':
      default:
        return '⏳';
    }
  };

  const getChunkStatusColor = (status: ChunkStatus['status']) => {
    switch (status) {
      case 'completed':
        return 'text-[#16bb7b] bg-[#e8fef5] border-[#8ef9d4]';
      case 'processing':
        return 'text-[#3a4ac3] dark:text-blue-400 bg-[#f0f2fe] dark:bg-blue-900/30 border-[#c0cbfb]';
      case 'failed':
        return 'text-[#cc0040] bg-[#fff0f5] border-[#ffc0d6]';
      case 'pending':
      default:
        return 'text-[#4a4a4c] dark:text-gray-300 bg-[#f5f5f6] dark:bg-gray-800 border-[#e7e7e9] dark:border-gray-700';
    }
  };

  return (
    <div className={`bg-white dark:bg-gray-900 border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4 ${className}`}>
      {/* Progress Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-[#000000] dark:text-white">
            Progreso de Procesamiento
          </h3>
          {isPaused && (
            <span className="bg-[#e0e5fd] text-[#2b3892] px-2 py-1 rounded-full text-xs font-medium">
              Pausado
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {!isPaused ? (
            <button
              onClick={onPause}
              className="bg-[#8fa0f8] hover:bg-yellow-600 text-white px-3 py-1 rounded text-sm transition-colors"
              disabled={progress.processing_chunks === 0 && progress.completed_chunks === progress.total_chunks}
            >
              Pausar
            </button>
          ) : (
            <button
              onClick={onResume}
              className="bg-[#1bea9a] hover:bg-[#16bb7b] text-white px-3 py-1 rounded text-sm transition-colors"
            >
              Reanudar
            </button>
          )}

          <button
            onClick={onCancel}
            className="bg-[#ff0050] hover:bg-[#cc0040] text-white px-3 py-1 rounded text-sm transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
            {progress.completed_chunks} de {progress.total_chunks} fragmentos completados
          </span>
          <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
            {completionPercentage}%
          </span>
        </div>

        <div className="w-full bg-[#d0d0d3] dark:bg-gray-600 rounded-full h-2">
          <div
            className="bg-[#3a4ac3] h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Processing Stats */}
      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div className="text-center">
          <div className="text-lg font-semibold text-[#16bb7b]">
            {progress.completed_chunks}
          </div>
          <div className="text-[#4a4a4c] dark:text-gray-300">Completados</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-[#3a4ac3] dark:text-blue-400">
            {progress.processing_chunks}
          </div>
          <div className="text-[#4a4a4c] dark:text-gray-300">Procesando</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-[#4a4a4c] dark:text-gray-300">
            {progress.total_chunks - progress.completed_chunks - progress.processing_chunks - progress.failed_chunks}
          </div>
          <div className="text-[#4a4a4c] dark:text-gray-300">Pendientes</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-[#cc0040]">
            {progress.failed_chunks}
          </div>
          <div className="text-[#4a4a4c] dark:text-gray-300">Fallidos</div>
        </div>
      </div>

      {/* Time Estimate */}
      {progress.estimated_remaining_ms && progress.estimated_remaining_ms > 0 && (
        <div className="bg-[#f0f2fe] dark:bg-blue-900/30 border border-[#c0cbfb] rounded-lg p-3 mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-[#3a4ac3] dark:text-blue-400">⏱️</span>
            <span className="text-sm text-[#1e2a6e]">
              Tiempo estimado restante: {formatTimeRemaining(progress.estimated_remaining_ms)}
            </span>
          </div>
        </div>
      )}

      {/* Recent Chunks Grid */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-2">
          Fragmentos Recientes ({Math.min(progress.chunks.length, 10)} de {progress.total_chunks})
        </h4>

        <div className="max-h-48 overflow-y-auto space-y-1">
          {progress.chunks
            .slice(-10) // Show last 10 chunks
            .reverse() // Most recent first
            .map((chunk) => (
              <div
                key={chunk.chunk_id}
                className={`text-xs p-2 rounded border ${getChunkStatusColor(chunk.status)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span>{getChunkStatusIcon(chunk.status)}</span>
                    <span className="font-medium">
                      Fragmento {chunk.chunk_id}
                    </span>
                    {chunk.duration_ms && (
                      <span className="text-[#6a6a6d] dark:text-gray-400">
                        ({formatDuration(chunk.duration_ms)})
                      </span>
                    )}
                  </div>

                  {chunk.status === 'processing' && (
                    <div className="flex items-center space-x-1">
                      <div className="animate-spin w-3 h-3 border border-[#3a4ac3] border-t-transparent rounded-full"></div>
                    </div>
                  )}
                </div>

                {chunk.text_preview && (
                  <div className="mt-1 text-[#3a3a3c] dark:text-gray-200 text-xs truncate">
                    "{chunk.text_preview}"
                  </div>
                )}

                {chunk.error_message && (
                  <div className="mt-1 text-[#990030] text-xs">
                    Error: {chunk.error_message}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Processing Complete */}
      {progress.completed_chunks === progress.total_chunks && progress.total_chunks > 0 && (
        <div className="mt-4 bg-[#e8fef5] border border-[#8ef9d4] rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <span className="text-[#16bb7b]">🎉</span>
            <span className="text-sm font-medium text-[#0d6b4a]">
              ¡Procesamiento completado! Se han transcrito los {progress.total_chunks} fragmentos.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Mini version for sidebar or compact display
export function ChunkProgressMini({ progress, className = '' }: { progress: ProcessingProgress; className?: string }) {
  const completionPercentage = progress.total_chunks > 0
    ? Math.round((progress.completed_chunks / progress.total_chunks) * 100)
    : 0;

  return (
    <div className={`bg-[#f5f5f6] dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
          Procesando
        </span>
        <span className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
          {completionPercentage}%
        </span>
      </div>

      <div className="w-full bg-[#d0d0d3] dark:bg-gray-600 rounded-full h-1.5 mb-2">
        <div
          className="bg-[#3a4ac3] h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      <div className="text-xs text-[#4a4a4c] dark:text-gray-300">
        {progress.completed_chunks} / {progress.total_chunks} fragmentos
        {progress.processing_chunks > 0 && (
          <span className="ml-2 text-[#3a4ac3] dark:text-blue-400">
            ({progress.processing_chunks} procesando)
          </span>
        )}
      </div>
    </div>
  );
}