'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Zap, BarChart2, Download, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useUserRole } from '@/hooks/useUserRole';

const MODEL_DEFS = [
  {
    name: 'gemma3:1b',
    label: 'Tips en vivo',
    Icon: Zap,
    iconColor: 'text-emerald-500',
    size: '~1 GB',
    sizeMb: 1019,
    description: 'Sugerencias instantáneas durante la reunión. Respuesta en < 2 s.',
  },
  {
    name: 'gemma3:4b',
    label: 'Evaluación post-reunión',
    Icon: BarChart2,
    iconColor: 'text-[#485df4]',
    size: '~2.4 GB',
    sizeMb: 2374,
    description: 'Análisis detallado de tu comunicación. Mayor calidad en resúmenes.',
  },
] as const;

type ModelName = typeof MODEL_DEFS[number]['name'];

interface ModelProgress {
  installed: boolean;
  downloading: boolean;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  error?: string;
}

function makeInitial(sizeMb: number): ModelProgress {
  return { installed: false, downloading: false, progress: 0, downloadedMb: 0, totalMb: sizeMb };
}

export function ModelDownloadStep() {
  const { completeOnboarding } = useOnboarding();
  const { isAdmin } = useUserRole();

  const [state, setState] = useState<Record<ModelName, ModelProgress>>({
    'gemma3:1b': makeInitial(1019),
    'gemma3:4b': makeInitial(2374),
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Check installed status on mount
  useEffect(() => {
    invoke<Array<{ name: string; status: string }>>('builtin_ai_list_models')
      .then(list => {
        setState(prev => {
          const next = { ...prev };
          for (const m of list) {
            const name = m.name as ModelName;
            if (name in next) {
              next[name] = { ...next[name], installed: m.status === 'Available' };
            }
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  // Auto-complete if both already installed
  useEffect(() => {
    const allInstalled = MODEL_DEFS.every(m => state[m.name].installed);
    if (allInstalled) {
      void completeOnboarding();
    }
  }, [state, completeOnboarding]);

  // Listen to download progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{
      model: string;
      progress: number;
      downloaded_mb: number;
      total_mb: number;
      status: string;
    }>('builtin-ai-download-progress', (e) => {
      const { model, progress, downloaded_mb, total_mb, status } = e.payload;
      const name = model as ModelName;
      setState(prev => {
        if (!(name in prev)) return prev;
        return {
          ...prev,
          [name]: {
            ...prev[name],
            progress,
            downloadedMb: downloaded_mb,
            totalMb: total_mb > 0 ? total_mb : prev[name].totalMb,
            downloading: status !== 'completed',
            installed: status === 'completed',
            error: undefined,
          },
        };
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    setGlobalError(null);

    for (const def of MODEL_DEFS) {
      if (state[def.name].installed) continue;

      setState(prev => ({
        ...prev,
        [def.name]: { ...prev[def.name], downloading: true, error: undefined },
      }));

      try {
        await invoke('builtin_ai_download_model', { modelName: def.name });
      } catch (err) {
        const msg = String(err);
        setGlobalError(msg);
        setState(prev => ({
          ...prev,
          [def.name]: { ...prev[def.name], downloading: false, error: msg },
        }));
        setIsDownloading(false);
        return;
      }
    }

    setIsDownloading(false);
    await completeOnboarding();
  }, [state, completeOnboarding]);

  const allInstalled = MODEL_DEFS.every(m => state[m.name].installed);
  const totalGb = ((1019 + 2374) / 1024).toFixed(1);

  return (
    <OnboardingContainer
      title="Tu IA personal"
      description="Maity descarga dos modelos pequeños que funcionan sin internet ni suscripción."
      step={3}
      totalSteps={3}
    >
      <div className="flex flex-col items-center space-y-6 w-full max-w-md">

        {/* Model cards */}
        <div className="w-full space-y-3">
          {MODEL_DEFS.map(def => {
            const s = state[def.name];
            const { Icon } = def;
            const showProgress = s.downloading || (s.progress > 0 && !s.installed);

            return (
              <div
                key={def.name}
                className="rounded-xl border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${def.iconColor}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{def.label}</span>
                        <span className="text-xs text-muted-foreground">{def.size}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 mt-0.5">
                    {s.installed && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                    {s.downloading && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                  </div>
                </div>

                {showProgress && (
                  <div className="space-y-1 pl-8">
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${s.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {s.downloadedMb.toFixed(0)}/{s.totalMb} MB · {s.progress}%
                    </p>
                  </div>
                )}

                {s.error && (
                  <div className="pl-8 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {s.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {globalError && (
          <p className="text-xs text-destructive text-center">{globalError}</p>
        )}

        {/* Actions */}
        {!allInstalled && !isDownloading && (
          <Button
            onClick={handleDownload}
            className="w-full h-11 bg-[#1bea9a] hover:bg-[#17d48b] text-gray-900 font-medium"
          >
            <Download className="w-4 h-4 mr-2" />
            Descargar modelos ({totalGb} GB total)
          </Button>
        )}

        {isDownloading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Descargando… no cierres la app.
          </div>
        )}

        {isAdmin && !isDownloading && !allInstalled && (
          <button
            onClick={() => void completeOnboarding()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Omitir por ahora (solo admins)
          </button>
        )}
      </div>
    </OnboardingContainer>
  );
}
