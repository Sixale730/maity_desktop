'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  CheckCircle2,
  Circle,
  CheckCircle,
  Download,
  Loader2,
  RefreshCw,
  X,
  Zap,
  BarChart2,
  Layers,
} from 'lucide-react';

interface RecordingPipeline {
  id: string;
  name: string;
  description: string;
  stt: { type: string; model?: string; language?: string };
  live_feedback: { model: string; endpoint: string } | null;
  analysis_model: string;
  analysis_provider: string;
}

interface GgufModelInfo {
  id: string;
  name: string;
  size_gb: number;
  ram_gb: number;
  use_case: string;
  description: string;
  installed: boolean;
  is_tips_model: boolean;
  is_eval_model: boolean;
}

interface LlamaServerStatus {
  model_id: string;
  port: number;
  running: boolean;
  endpoint: string;
}

interface DownloadState {
  progress: number;
  downloaded_mb: number;
  total_mb: number;
}

type SetupStep = 'idle' | 'checking' | 'downloading_binary' | 'binary_ready' | 'downloading_model' | 'model_ready' | 'starting_server' | 'complete' | 'error';

export function PipelineSelector() {
  const [pipelines, setPipelines] = useState<RecordingPipeline[]>([]);
  const [activeId, setActiveId] = useState<string>('local_parakeet_gemma');
  const [saving, setSaving] = useState(false);

  const [ggufModels, setGgufModels] = useState<GgufModelInfo[]>([]);
  const [engineStatus, setEngineStatus] = useState<LlamaServerStatus[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  const [setupStep, setSetupStep] = useState<SetupStep>('idle');
  const [setupProgress, setSetupProgress] = useState(0);
  const [setupMessage, setSetupMessage] = useState('');

  // Load pipelines + model list
  useEffect(() => {
    const load = async () => {
      try {
        const [pipelinesRes, activeRes] = await Promise.all([
          invoke<RecordingPipeline[]>('get_available_pipelines'),
          invoke<string>('get_active_pipeline_id'),
        ]);
        setPipelines(pipelinesRes);
        setActiveId(activeRes);
      } catch (e) {
        console.error('Error loading pipelines:', e);
      }
    };
    load();
    refreshModels();
    refreshEngineStatus();
  }, []);

  // Listen to setup progress
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ step: string; progress: number; message: string }>(
      'coach-setup-progress',
      (e) => {
        setSetupStep(e.payload.step as SetupStep);
        setSetupProgress(e.payload.progress);
        setSetupMessage(e.payload.message);
      }
    ).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Listen to per-model download progress
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ model_id: string; progress: number; downloaded_mb: number; total_mb: number }>(
      'coach-gguf-download-progress',
      (e) => {
        const { model_id, progress, downloaded_mb, total_mb } = e.payload;
        setDownloads((prev) => ({ ...prev, [model_id]: { progress, downloaded_mb, total_mb } }));
      }
    ).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Refresh model list when a download completes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ model_id: string }>('coach-gguf-download-complete', (e) => {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[e.payload.model_id];
        return next;
      });
      refreshModels();
      refreshEngineStatus();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Clear download state when a download errors or is cancelled
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ model_id: string; error: string }>('coach-gguf-download-error', (e) => {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[e.payload.model_id];
        return next;
      });
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const refreshModels = async () => {
    try {
      const models = await invoke<GgufModelInfo[]>('coach_list_gguf_models');
      setGgufModels(models);
    } catch (e) {
      console.error('Error loading GGUF models:', e);
    }
  };

  const refreshEngineStatus = async () => {
    try {
      const status = await invoke<LlamaServerStatus[]>('coach_get_engine_status');
      setEngineStatus(status);
    } catch (e) {
      console.error('Error loading engine status:', e);
    }
  };

  const handleSelect = async (id: string) => {
    if (id === activeId || saving) return;
    setSaving(true);
    try {
      await invoke('set_active_pipeline', { pipelineId: id });
      setActiveId(id);
    } catch (e) {
      console.error('Error setting pipeline:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleSetupCoach = async () => {
    try {
      await invoke('install_coach_if_needed', { modelId: 'qwen25-3b-q4' });
      refreshModels();
      refreshEngineStatus();
    } catch (e) {
      setSetupStep('error');
      setSetupMessage(String(e));
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    try {
      await invoke('coach_download_gguf_model', { modelId });
    } catch (e) {
      console.error('Error starting download:', e);
    }
  };

  const handleSwitchModel = async (purpose: 'tips' | 'eval', modelId: string) => {
    try {
      await invoke('coach_switch_model', { purpose, modelId });
      await refreshModels();
      await refreshEngineStatus();
    } catch (e) {
      console.error('Error switching model:', e);
    }
  };

  const isRunningSetup = setupStep !== 'idle' && setupStep !== 'complete' && setupStep !== 'error';
  const hasAnyInstalled = ggufModels.some((m) => m.installed);
  const needsInitialSetup = !hasAnyInstalled;
  const qwenModels = ggufModels.filter((m) => m.id.startsWith('qwen'));
  const gemmaModels = ggufModels.filter((m) => m.id.startsWith('gemma'));

  const sttLabel = (stt: RecordingPipeline['stt']) => {
    switch (stt.type) {
      case 'parakeet': return 'Parakeet (local)';
      case 'moonshine': return 'Moonshine (local)';
      case 'whisper': return `Whisper ${stt.model ?? ''} (local)`;
      case 'deepgram': return 'Deepgram (nube)';
      default: return stt.type;
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Pipeline de grabación</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Elige la combinación de STT + coaching que mejor se adapte a tu setup.
        </p>
      </div>

      {/* Pipeline cards */}
      <div className="grid gap-3">
        {pipelines.map((pipeline) => {
          const isActive = pipeline.id === activeId;
          return (
            <button
              key={pipeline.id}
              onClick={() => handleSelect(pipeline.id)}
              disabled={saving}
              className={`w-full text-left rounded-xl border p-4 transition-all duration-150 ${
                isActive
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:border-muted-foreground/40 hover:bg-accent/30'
              } ${saving ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium text-foreground text-sm">{pipeline.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 ml-6">{pipeline.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-3 ml-6">
                    <Badge label="STT" value={sttLabel(pipeline.stt)} />
                    {pipeline.live_feedback ? (
                      <Badge label="Coach" value={pipeline.live_feedback.model} variant="green" />
                    ) : (
                      <Badge label="Coach" value="Sin feedback en vivo" variant="muted" />
                    )}
                    <Badge label="Análisis" value={pipeline.analysis_model} variant="blue" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Coach IA section */}
      <div className="rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Modelos de Coach IA (local)</span>
          <button
            onClick={refreshModels}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
        </div>

        {/* Setup progress */}
        {isRunningSetup && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{setupMessage}</span>
              <span className="font-medium tabular-nums">{setupProgress}%</span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${setupProgress}%` }}
              />
            </div>
            {setupStep === 'starting_server' && (
              <p className="text-xs text-muted-foreground">
                En modo CPU esto puede tardar 1-2 minutos…
              </p>
            )}
          </div>
        )}

        {/* Complete */}
        {setupStep === 'complete' && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">¡Coach IA listo!</span>
          </div>
        )}

        {/* Error */}
        {setupStep === 'error' && (
          <div className="space-y-2">
            <p className="text-xs text-red-400">{setupMessage}</p>
            <button
              onClick={() => setSetupStep('idle')}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        )}

        {/* Initial setup CTA */}
        {!isRunningSetup && setupStep !== 'complete' && needsInitialSetup && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Instala llama-server y descarga Qwen 2.5 3B (~2.0 GB) para activar los tips en vivo.
              Sin instaladores, sin UAC — todo queda en la carpeta de la app.
            </p>
            <button
              onClick={handleSetupCoach}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" />
              Configurar Coach IA
            </button>
          </div>
        )}

        {/* Qwen model list — shown after initial setup */}
        {!isRunningSetup && !needsInitialSetup && qwenModels.length > 0 && (
          <div className="space-y-2">
            {gemmaModels.length > 0 && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Qwen</p>
            )}
            {qwenModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                dl={downloads[model.id]}
                serverRunning={engineStatus.some((s) => s.model_id === model.id && s.running)}
                onDownload={handleDownloadModel}
                onSwitch={handleSwitchModel}
              />
            ))}
          </div>
        )}

        {/* Gemma model list — always visible (download works independently of initial setup) */}
        {!isRunningSetup && gemmaModels.length > 0 && (
          <div className={`space-y-2 ${!needsInitialSetup && qwenModels.length > 0 ? 'mt-3' : ''}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gemma 3</p>
              {needsInitialSetup && (
                <span className="text-xs text-muted-foreground">Requiere llama-server instalado</span>
              )}
            </div>
            {gemmaModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                dl={downloads[model.id]}
                serverRunning={engineStatus.some((s) => s.model_id === model.id && s.running)}
                onDownload={handleDownloadModel}
                onSwitch={handleSwitchModel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ModelCardProps {
  model: GgufModelInfo;
  dl: DownloadState | undefined;
  serverRunning: boolean;
  onDownload: (id: string) => void;
  onSwitch: (purpose: 'tips' | 'eval', id: string) => void;
}

function ModelCard({ model, dl, serverRunning, onDownload, onSwitch }: ModelCardProps) {
  const isDownloading = !!dl;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {model.installed ? (
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          ) : (
            <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{model.name}</span>
              <UseCaseBadge use_case={model.use_case} />
              <span className="text-xs text-muted-foreground">{model.size_gb} GB</span>
              {serverRunning && (
                <span className="flex items-center gap-1 text-xs text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  activo
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {model.installed && !model.is_tips_model && model.use_case !== 'eval' && (
            <button
              onClick={() => onSwitch('tips', model.id)}
              className="text-xs text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
            >
              Usar para tips
            </button>
          )}
          {model.installed && !model.is_eval_model && model.use_case !== 'tips' && (
            <button
              onClick={() => onSwitch('eval', model.id)}
              className="text-xs text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
            >
              Usar para eval
            </button>
          )}
          {!model.installed && !isDownloading && (
            <button
              onClick={() => onDownload(model.id)}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </button>
          )}
        </div>
      </div>

      {model.installed && (model.is_tips_model || model.is_eval_model) && (
        <div className="flex gap-1.5 ml-6">
          {model.is_tips_model && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Zap className="w-3 h-3" />
              Tips en vivo
            </span>
          )}
          {model.is_eval_model && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <BarChart2 className="w-3 h-3" />
              Evaluación
            </span>
          )}
        </div>
      )}

      {isDownloading && dl && (
        <div className="ml-6 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Descargando...
            </span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {dl.downloaded_mb.toFixed(0)}/{dl.total_mb.toFixed(0)} MB ({dl.progress}%)
              </span>
              <button
                onClick={() => invoke('cancel_gguf_download', { modelId: model.id })}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Cancelar descarga"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${dl.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function UseCaseBadge({ use_case }: { use_case: string }) {
  if (use_case === 'tips') return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <Zap className="w-3 h-3" />Tips
    </span>
  );
  if (use_case === 'eval') return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400">
      <BarChart2 className="w-3 h-3" />Eval
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
      <Layers className="w-3 h-3" />Ambos
    </span>
  );
}

function Badge({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: string;
  variant?: 'default' | 'green' | 'blue' | 'muted';
}) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    muted: 'bg-muted/50 text-muted-foreground/60',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${colors[variant]}`}>
      <span className="opacity-60">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
