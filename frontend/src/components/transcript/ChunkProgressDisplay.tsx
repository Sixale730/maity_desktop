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
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30';
      case 'processing':
        return 'text-maity-blue bg-maity-blue/10 border-maity-blue/30';
      case 'failed':
        return 'text-destructive bg-destructive/10 border-destructive/30';
      case 'pending':
      default:
        return 'text-muted-foreground bg-muted border-border';
    }
  };

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      {/* Progress Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-foreground">
            Progreso de Procesamiento
          </h3>
          {isPaused && (
            <span className="bg-maity-blue/15 text-[#2b3892] dark:text-[#a0b0f9] px-2 py-1 rounded-full text-xs font-medium">
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
          <span className="text-sm font-medium text-foreground">
            {progress.completed_chunks} de {progress.total_chunks} fragmentos completados
          </span>
          <span className="text-sm font-medium text-foreground">
            {completionPercentage}%
          </span>
        </div>

        <div className="w-full bg-border-strong rounded-full h-2">
          <div
            className="bg-[#3a4ac3] h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Processing Stats */}
      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div className="text-center">
          <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            {progress.completed_chunks}
          </div>
          <div className="text-muted-foreground">Completados</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-maity-blue">
            {progress.processing_chunks}
          </div>
          <div className="text-muted-foreground">Procesando</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-muted-foreground">
            {progress.total_chunks - progress.completed_chunks - progress.processing_chunks - progress.failed_chunks}
          </div>
          <div className="text-muted-foreground">Pendientes</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-destructive">
            {progress.failed_chunks}
          </div>
          <div className="text-muted-foreground">Fallidos</div>
        </div>
      </div>

      {/* Time Estimate */}
      {progress.estimated_remaining_ms && progress.estimated_remaining_ms > 0 && (
        <div className="bg-maity-blue/10 border border-maity-blue/30 rounded-lg p-3 mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-maity-blue">⏱️</span>
            <span className="text-sm text-[#1e2a6e] dark:text-[#c0cbfb]">
              Tiempo estimado restante: {formatTimeRemaining(progress.estimated_remaining_ms)}
            </span>
          </div>
        </div>
      )}

      {/* Recent Chunks Grid */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground mb-2">
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
                      <span className="text-muted-foreground">
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
                  <div className="mt-1 text-foreground text-xs truncate">
                    &quot;{chunk.text_preview}&quot;
                  </div>
                )}

                {chunk.error_message && (
                  <div className="mt-1 text-destructive text-xs">
                    Error: {chunk.error_message}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Processing Complete */}
      {progress.completed_chunks === progress.total_chunks && progress.total_chunks > 0 && (
        <div className="mt-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <span className="text-emerald-600 dark:text-emerald-400">🎉</span>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
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
    <div className={`bg-muted border border-border rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">
          Procesando
        </span>
        <span className="text-sm font-medium text-foreground">
          {completionPercentage}%
        </span>
      </div>

      <div className="w-full bg-border-strong rounded-full h-1.5 mb-2">
        <div
          className="bg-[#3a4ac3] h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {progress.completed_chunks} / {progress.total_chunks} fragmentos
        {progress.processing_chunks > 0 && (
          <span className="ml-2 text-maity-blue">
            ({progress.processing_chunks} procesando)
          </span>
        )}
      </div>
    </div>
  );
}