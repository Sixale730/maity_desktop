import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  CanaryModelInfo,
  CanaryModelStatus,
  CanaryAPI,
  getCanaryModelDisplayInfo,
  getCanaryModelDisplayName,
  formatFileSize
} from '../lib/canary';

interface CanaryModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function CanaryModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: CanaryModelManagerProps) {
  const [models, setModels] = useState<CanaryModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());

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
        await CanaryAPI.init();
        const modelList = await CanaryAPI.getAvailableModels();
        setModels(modelList);

        if (!selectedModel) {
          const available = modelList.find(m => m.status === 'Available');
          if (available && onModelSelect) {
            onModelSelect(available.name);
          }
        }

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Canary:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Error al cargar modelos Canary', {
          description: err instanceof Error ? err.message : 'Error desconocido',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // Event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'canary-model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });
            setModels(prev =>
              prev.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: progress } as CanaryModelStatus }
                  : model
              )
            );
          }
        }
      );

      unlistenComplete = await listen<{ modelName: string }>(
        'canary-model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const displayInfo = getCanaryModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prev =>
            prev.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as CanaryModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayInfo?.icon || '✓'} ¡${displayName} listo!`, {
            description: 'Modelo descargado y listo para usar',
            duration: 4000
          });

          if (onModelSelectRef.current) {
            onModelSelectRef.current(modelName);
            if (autoSaveRef.current) {
              saveModelSelection(modelName);
            }
          }
        }
      );

      unlistenError = await listen<{ modelName: string; error: string }>(
        'canary-model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayInfo = getCanaryModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prev =>
            prev.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as CanaryModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

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
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, []);

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'canary',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      console.error('Failed to save Canary model selection:', error);
    }
  };

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getCanaryModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await CanaryAPI.cancelDownload(modelName);

      setDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      setModels(prev =>
        prev.map(model =>
          model.name === modelName
            ? { ...model, status: 'Missing' as CanaryModelStatus }
            : model
        )
      );

      progressThrottleRef.current.delete(modelName);
      toast.info(`Descarga de ${displayName} cancelada`, { duration: 3000 });
    } catch (err) {
      toast.error('Error al cancelar descarga', {
        description: err instanceof Error ? err.message : 'Error desconocido',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    const displayInfo = getCanaryModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      setDownloadingModels(prev => new Set([...prev, modelName]));
      setModels(prev =>
        prev.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: 0 } as CanaryModelStatus }
            : model
        )
      );

      toast.info(`Descargando ${displayName}...`, {
        description: 'Esto puede tomar unos minutos (~939 MB)',
        duration: 5000
      });

      await CanaryAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Canary download failed:', err);
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

    const displayInfo = getCanaryModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;
    toast.success(`Cambiado a ${displayName}`, { duration: 3000 });
  };

  const deleteModel = async (modelName: string) => {
    const displayInfo = getCanaryModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await CanaryAPI.deleteModel(modelName);
      const modelList = await CanaryAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} eliminado`, {
        description: 'Modelo eliminado para liberar espacio',
        duration: 3000
      });

      if (selectedModel === modelName && onModelSelect) {
        onModelSelect('');
      }
    } catch (err) {
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
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-[#fff0f5] border border-[#ffc0d6] rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-800">Error al cargar modelos Canary</p>
        <p className="text-xs text-[#cc0040] mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {models.map(model => {
        const displayInfo = getCanaryModelDisplayInfo(model.name);
        const displayName = displayInfo?.friendlyName || model.name;
        const icon = displayInfo?.icon || '🐦';
        const tagline = displayInfo?.tagline || model.description || '';

        const isAvailable = model.status === 'Available';
        const isMissing = model.status === 'Missing';
        const isError = typeof model.status === 'object' && 'Error' in model.status;
        const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
        const downloadProgress =
          typeof model.status === 'object' && 'Downloading' in model.status
            ? model.status.Downloading
            : null;
        const isSelected = selectedModel === model.name;

        return (
          <motion.div
            key={model.name}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`
              relative rounded-lg border-2 transition-all cursor-pointer
              ${isSelected && isAvailable
                ? 'border-[#485df4] bg-[#f0f2fe] dark:bg-blue-900/30'
                : isAvailable
                  ? 'border-[#e7e7e9] dark:border-gray-700 hover:border-[#d0d0d3] dark:hover:border-gray-600 bg-white dark:bg-gray-900'
                  : 'border-[#e7e7e9] dark:border-gray-700 bg-[#f5f5f6] dark:bg-gray-800'
              }
              ${isAvailable ? '' : 'cursor-default'}
            `}
            onClick={() => { if (isAvailable) selectModel(model.name); }}
          >
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{icon}</span>
                    <h3 className="font-semibold text-[#000000] dark:text-white">{displayName}</h3>
                    <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded font-medium">Int8</span>
                    <span className="text-xs text-[#6a6a6d] dark:text-gray-400">{formatFileSize(model.size_mb)}</span>
                    {isSelected && isAvailable && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="bg-[#3a4ac3] text-white px-2 py-0.5 rounded-full text-xs font-medium"
                      >
                        ✓
                      </motion.span>
                    )}
                  </div>
                  <p className="text-sm text-[#4a4a4c] dark:text-gray-300 ml-9">{tagline}</p>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  {isAvailable && (
                    <div className="flex items-center gap-1.5 text-[#16bb7b]">
                      <div className="w-2 h-2 bg-[#1bea9a] rounded-full"></div>
                      <span className="text-xs font-medium">Listo</span>
                    </div>
                  )}

                  {isMissing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadModel(model.name); }}
                      className="bg-[#3a4ac3] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#2b3892] transition-colors"
                    >
                      Descargar
                    </button>
                  )}

                  {downloadProgress === null && isError && (
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadModel(model.name); }}
                      className="bg-[#cc0040] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#990030] transition-colors"
                    >
                      Reintentar
                    </button>
                  )}

                  {isCorrupted && (
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteModel(model.name); }}
                        className="bg-[#cc3366] text-white px-3 py-1.5 rounded-md text-sm font-medium"
                      >
                        Eliminar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadModel(model.name); }}
                        className="bg-[#3a4ac3] text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-[#2b3892]"
                      >
                        Re-descargar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Download Progress */}
              {downloadProgress !== null && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 pt-3 border-t border-[#e7e7e9] dark:border-gray-700"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#3a4ac3] dark:text-blue-400">Descargando...</span>
                      <span className="text-sm font-semibold text-[#3a4ac3] dark:text-blue-400">{Math.round(downloadProgress)}%</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelDownload(model.name); }}
                      className="text-xs text-[#4a4a4c] dark:text-gray-300 hover:text-[#cc0040] font-medium transition-colors px-2 py-1 rounded hover:bg-[#fff0f5]"
                    >
                      Cancelar
                    </button>
                  </div>
                  <div className="w-full h-2 bg-[#d0d0d3] dark:bg-gray-600 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${downloadProgress}%` }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-1">
                    {formatFileSize(model.size_mb * downloadProgress / 100)} / {formatFileSize(model.size_mb)}
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        );
      })}

      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-[#6a6a6d] dark:text-gray-400 text-center pt-2"
        >
          Usando {getCanaryModelDisplayName(selectedModel)} para transcripcion
        </motion.div>
      )}
    </div>
  );
}
