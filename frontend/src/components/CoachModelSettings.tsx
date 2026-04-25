'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { toast } from 'sonner';

interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

const RECOMMENDED: Record<string, { tag: string; reason: string }> = {
  'gemma3:1b': { tag: 'Recomendado', reason: 'Default Maity, ~1GB, latencia <2s' },
  'phi3.5:3.8b-mini-instruct-q4_K_M': { tag: 'Calidad media', reason: 'MIT, ~2.3GB' },
  'gemma4:e4b': { tag: 'Calidad alta', reason: 'Apache 2.0, abril 2026' },
  'qwen3:8b': { tag: 'Multilingüe', reason: 'Mejor español que phi/gemma' },
};

/**
 * CoachModelSettings — selector de modelo Ollama para el coach overlay (Director-inspired).
 *
 * El coach se inicia automáticamente al arrancar grabación si coachEnabled=true.
 * Este selector elige qué modelo Ollama recibe `start_coach_overlay(modelName)`.
 * Persiste en localStorage vía ConfigContext para sobrevivir reinicios.
 */
export function CoachModelSettings() {
  const { coachModel, setCoachModel, coachEnabled, setCoachEnabled } = useConfig();
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<OllamaModel[]>('get_ollama_models', { endpoint: null });
      setModels(list);
    } catch (e) {
      setError(typeof e === 'string' ? e : `${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleSelect = (name: string) => {
    if (name === coachModel) return;
    setCoachModel(name);
    toast.success(`Coach IA usará: ${name} (próxima grabación)`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Modelo del Coach IA</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Maity arranca un overlay del coach al iniciar grabación.
            Elige qué modelo Ollama usar (privacidad: solo local).
          </p>
        </div>
        <button
          type="button"
          onClick={fetchModels}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md border hover:bg-accent transition disabled:opacity-50"
          title="Recargar modelos Ollama"
        >
          <RefreshCw className={`w-3.5 h-3.5 inline-block mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card cursor-pointer">
        <input
          type="checkbox"
          checked={coachEnabled}
          onChange={(e) => setCoachEnabled(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm">Habilitar Coach IA durante grabaciones</span>
      </label>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 border-b">
          <div className="text-xs font-medium">
            Modelo activo: <code className="text-blue-600 dark:text-blue-400">{coachModel}</code>
          </div>
        </div>

        {error && (
          <div className="px-4 py-6 flex items-center gap-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <div className="font-medium">No se pudieron cargar modelos</div>
              <div className="text-xs opacity-80 mt-0.5">{error}</div>
              <div className="text-xs mt-1">Verifica Ollama: <code>ollama serve</code></div>
            </div>
          </div>
        )}

        {!error && loading && models.length === 0 && (
          <div className="px-4 py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Consultando Ollama…
          </div>
        )}

        {!error && !loading && models.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Sin modelos Ollama instalados. Descarga uno: <code>ollama pull gemma3:1b</code>
          </div>
        )}

        {models.length > 0 && (
          <div className="divide-y">
            {models.map((m) => {
              const isActive = m.name === coachModel;
              const meta = RECOMMENDED[m.name];
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.name)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${
                    isActive ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="flex-shrink-0 w-5">
                    {isActive ? (
                      <CheckCircle2 className="w-5 h-5 text-blue-500" />
                    ) : (
                      <span className="block w-4 h-4 rounded-full border-2" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm truncate">{m.name}</span>
                      {meta && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                          {meta.tag}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {meta?.reason ?? `${m.size} · ${m.modified}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground leading-relaxed">
        <strong>Privacidad:</strong> el coach overlay solo usa Ollama local (sin egreso de datos
        del transcript a nube). El modelo se aplica a la próxima grabación que inicies.
      </div>
    </div>
  );
}
