import React, { useState, useEffect, useRef } from 'react';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  ParakeetModelInfo,
  ModelStatus,
  ParakeetAPI,
  getModelDisplayInfo,
  getModelDisplayName,
  formatFileSize
} from '@/lib/engines/parakeet';
import { logger } from '@/lib/logger';
import { TauriEvent } from '@/lib/tauri-events';

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  // Refs for stable callbacks
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Initialize and load models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const modelList = await ParakeetAPI.getAvailableModels();
        setModels(modelList);

        // Auto-select first available model if none selected
        if (!selectedModel) {
          const recommendedModel = modelList.find(m =>
            m.name === 'parakeet-tdt-0.6b-v3-int8' && m.status === 'Available'
          );
          const anyAvailable = modelList.find(m => m.status === 'Available');
          const toSelect = recommendedModel || anyAvailable;

          if (toSelect && onModelSelect) {
            onModelSelect(toSelect.name);
          }
        }

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Parakeet:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Error al cargar modelos de transcripción', {
          description: err instanceof Error ? err.message : 'Error desconocido',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // Set up event listeners for download progress
  useEffect(() => {
    const subs = createSubscriptionGroup();

    const setupListeners = async () => {
      logger.debug('[ParakeetModelManager] Setting up event listeners...');

      // Download progress with throttling
      subs.on<{ modelName: string; progress: number }>(
        TauriEvent.PARAKEET_MODEL_DOWNLOAD_PROGRESS,
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            logger.debug(`[ParakeetModelManager] Progress update for ${modelName}: ${progress}%`);
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: progress } as ModelStatus }
                  : model
              )
            );
          }
        }
      );

      // Download complete
      subs.on<{ modelName: string }>(
        TauriEvent.PARAKEET_MODEL_DOWNLOAD_COMPLETE,
        (event) => {
          const { modelName } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayInfo?.icon || '✓'} ¡${displayName} listo!`, {
            description: 'Modelo descargado y listo para usar',
            duration: 4000
          });

          // Auto-select after download using stable refs
          if (onModelSelectRef.current) {
            onModelSelectRef.current(modelName);
            if (autoSaveRef.current) {
              saveModelSelection(modelName);
            }
          }
        }
      );

      // Download error
      subs.on<{ modelName: string; error: string }>(
        TauriEvent.PARAKEET_MODEL_DOWNLOAD_ERROR,
        (event) => {
          const { modelName, error } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Error al descargar ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: 'Reintentar',
              onClick: () => downloadModel(modelName)
            }
          });
        }
      );
    };

    setupListeners();

    return () => {
      logger.debug('[ParakeetModelManager] Cleaning up event listeners...');
      subs.dispose();
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'parakeet',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  };

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.cancelDownload(modelName);

      setDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: 'Missing' as ModelStatus }
            : model
        )
      );

      // Clean up throttle data
      progressThrottleRef.current.delete(modelName);

      toast.info(`Descarga de ${displayName} cancelada`, {
        duration: 3000
      });
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Error al cancelar descarga', {
        description: err instanceof Error ? err.message : 'Error desconocido',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      setDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: 0 } as ModelStatus }
            : model
        )
      );

      toast.info(`Descargando ${displayName}...`, {
        description: 'Esto puede tomar unos minutos',
        duration: 5000  // Auto-dismiss after 5 seconds
      });

      await ParakeetAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setModels(prev =>
        prev.map(model =>
          model.name === modelName ? { ...model, status: { Error: errorMessage } } : model
        )
      );
    }
  };

  const selectModel = async (modelName: string) => {
    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;
    toast.success(`Cambiado a ${displayName}`, {
      duration: 3000
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await ParakeetAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} eliminado`, {
        description: 'Modelo eliminado para liberar espacio',
        duration: 3000
      });

      // If deleted model was selected, clear selection
      if (selectedModel === modelName && onModelSelect) {
        onModelSelect('');
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error(`Error al eliminar ${displayName}`, {
        description: err instanceof Error ? err.message : 'Error al eliminar',
        duration: 4000
      });
    }
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-[#e7e7e9] dark:bg-gray-700 rounded-lg"></div>
          <div className="h-20 bg-[#e7e7e9] dark:bg-gray-700 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-[#fff0f5] border border-[#ffc0d6] rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-800">Error al cargar modelos</p>
        <p className="text-xs text-[#cc0040] mt-1">{error}</p>
      </div>
    );
  }

  const recommendedModel = models.find(m =>
    m.name === 'parakeet-tdt-0.6b-v3-int8'
  );
  const otherModels = models.filter(m =>
    m.name !== 'parakeet-tdt-0.6b-v3-int8'
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Recommended Model */}
      {recommendedModel && (
        <ModelCard
          model={recommendedModel}
          isSelected={selectedModel === recommendedModel.name}
          isRecommended={true}
          onSelect={() => {
            if (recommendedModel.status === 'Available') {
              selectModel(recommendedModel.name);
            }
          }}
          onDownload={() => downloadModel(recommendedModel.name)}
          onCancel={() => cancelDownload(recommendedModel.name)}
          onDelete={() => deleteModel(recommendedModel.name)}
          isDownloading={downloadingModels.has(recommendedModel.name)}
        />
      )}

      {/* Other Models */}
      {otherModels.length > 0 && (
        <div className="space-y-3">
          {otherModels.map(model => (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={false}
              onSelect={() => {
                if (model.status === 'Available') {
                  selectModel(model.name);
                }
              }}
              onDownload={() => downloadModel(model.name)}
              onCancel={() => cancelDownload(model.name)}
              onDelete={() => deleteModel(model.name)}
              isDownloading={downloadingModels.has(model.name)}
            />
          ))}
        </div>
      )}

      {/* Helper text */}
      {selectedModel && (
        <div className="text-xs text-[#6a6a6d] dark:text-gray-400 text-center pt-2 animate-fade-in">
          Usando {getModelDisplayName(selectedModel)} para transcripción
        </div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading: _isDownloading
}: ModelCardProps) {
  const displayInfo = getModelDisplayInfo(model.name);
  const displayName = displayInfo?.friendlyName || model.name;
  const icon = displayInfo?.icon || '📦';
  const tagline = displayInfo?.tagline || model.description || '';

  const isAvailable = model.status === 'Available';
  const isMissing = model.status === 'Missing';
  const isError = typeof model.status === 'object' && 'Error' in model.status;
  const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const downloadProgress =
    typeof model.status === 'object' && 'Downloading' in model.status
      ? model.status.Downloading
      : null;

  return (
    <div
      className={`
        group relative rounded-lg border-2 transition-all cursor-pointer animate-rise-in
        ${isSelected && isAvailable
          ? 'border-[#485df4] bg-[#f0f2fe] dark:bg-blue-900/30'
          : isAvailable
            ? 'border-[#e7e7e9] dark:border-gray-700 hover:border-[#d0d0d3] dark:hover:border-gray-600 bg-white dark:bg-gray-900'
            : 'border-[#e7e7e9] dark:border-gray-700 bg-[#f5f5f6] dark:bg-gray-800'
        }
        ${isAvailable ? '' : 'cursor-default'}
      `}
      onClick={() => {
        if (isAvailable) onSelect();
      }}
    >
      {/* Recommended Badge */}
      {isRecommended && (
        <div className="absolute -top-2 -right-2 bg-[#3a4ac3] text-white text-xs px-2 py-0.5 rounded-full font-medium">
          Recomendado
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            {/* Model Name */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{icon}</span>
              <h3 className="font-semibold text-[#000000] dark:text-white">{displayName}</h3>
              {isSelected && isAvailable && (
                <span className="bg-[#3a4ac3] text-white px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 animate-scale-in">
                  ✓
                </span>
              )}
            </div>

            {/* Tagline */}
            <p className="text-sm text-[#4a4a4c] dark:text-gray-300 ml-9">{tagline}</p>
          </div>

          {/* Status/Action */}
          <div className="ml-4 flex items-center gap-2">
            {isAvailable && (
              <>
                <div className="flex items-center gap-1.5 text-[#16bb7b]">
                  <div className="w-2 h-2 bg-[#1bea9a] rounded-full"></div>
                  <span className="text-xs font-medium">Listo</span>
                </div>
                {/* Visible al pasar el mouse por la tarjeta (group-hover) o con
                    foco de teclado; antes era estado React + AnimatePresence. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-[#8a8a8d] dark:text-gray-500 hover:text-[#cc0040] dark:hover:text-red-400 transition-[opacity,color] duration-150 p-1"
                  title="Eliminar modelo para liberar espacio"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}

            {isMissing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="bg-[#3a4ac3] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#2b3892] transition-colors"
              >
                Descargar
              </button>
            )}

            {downloadProgress === null && isError && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="bg-[#cc0040] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#990030] transition-colors"
              >
                Reintentar
              </button>
            )}

            {isCorrupted && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="bg-[#cc3366] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#cc3366] transition-colors"
                >
                  Eliminar
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload();
                  }}
                  className="bg-[#3a4ac3] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#2b3892] transition-colors"
                >
                  Re-descargar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Full-width Download Progress Bar - PROMINENT */}
        {downloadProgress !== null && (
          <div className="mt-3 pt-3 border-t border-[#e7e7e9] dark:border-gray-700 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#3a4ac3] dark:text-blue-400">Descargando...</span>
                <span className="text-sm font-semibold text-[#3a4ac3] dark:text-blue-400">{Math.round(downloadProgress)}%</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="text-xs text-[#4a4a4c] dark:text-gray-300 hover:text-[#cc0040] dark:hover:text-red-400 font-medium transition-colors px-2 py-1 rounded hover:bg-[#fff0f5]"
                title="Cancelar descarga"
              >
                Cancelar
              </button>
            </div>
            <div className="w-full h-2 bg-[#d0d0d3] dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-1">
              {model.size_mb ? (
                <>
                  {formatFileSize(model.size_mb * downloadProgress / 100)} / {formatFileSize(model.size_mb)}
                </>
              ) : (
                'Descargando...'
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
