import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, Download, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';
import type { ModelConfig } from '../ModelSettingsModal';

interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

interface OllamaSettingsProps {
  ollamaEndpoint: string;
  setOllamaEndpoint: (value: string) => void;
  isEndpointSectionCollapsed: boolean;
  setIsEndpointSectionCollapsed: (value: boolean) => void;
  endpointValidationState: 'valid' | 'invalid' | 'none';
  isLoadingOllama: boolean;
  lastFetchedEndpoint: string;
  ollamaEndpointChanged: boolean;
  error: string;
  filteredModels: OllamaModel[];
  allModelsCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedModel: string;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  ollamaNotInstalled: boolean;
  isDownloading: (model: string) => boolean;
  getProgress: (model: string) => number | undefined;
  fetchOllamaModels: (silent?: boolean) => Promise<void>;
  downloadRecommendedModel: () => Promise<void>;
  onEndpointChange: (value: string) => void;
}

export function OllamaSettings({
  ollamaEndpoint,
  isEndpointSectionCollapsed,
  setIsEndpointSectionCollapsed,
  endpointValidationState,
  isLoadingOllama,
  lastFetchedEndpoint,
  ollamaEndpointChanged,
  error,
  filteredModels,
  allModelsCount,
  searchQuery,
  setSearchQuery,
  selectedModel,
  setModelConfig,
  ollamaNotInstalled,
  isDownloading,
  getProgress,
  fetchOllamaModels,
  downloadRecommendedModel,
  onEndpointChange,
}: OllamaSettingsProps) {
  return (
    <>
      {/* Endpoint Section */}
      <div>
        <div
          className="flex items-center justify-between cursor-pointer py-2"
          onClick={() => setIsEndpointSectionCollapsed(!isEndpointSectionCollapsed)}
        >
          <Label className="cursor-pointer">Endpoint Personalizado (opcional)</Label>
          {isEndpointSectionCollapsed ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {!isEndpointSectionCollapsed && (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-2">
              Dejar vacío o ingresar un endpoint personalizado (ej., http://x.yy.zz:11434)
            </p>
            <div className="flex gap-2 mt-1">
              <div className="relative flex-1">
                <Input
                  type="url"
                  value={ollamaEndpoint}
                  onChange={(e) => onEndpointChange(e.target.value)}
                  placeholder="http://localhost:11434"
                  className={cn(
                    "pr-10",
                    endpointValidationState === 'invalid' && "border-red-500"
                  )}
                />
                {endpointValidationState === 'valid' && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#1bea9a]" />
                )}
                {endpointValidationState === 'invalid' && (
                  <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#ff0050]" />
                )}
              </div>
              <Button
                type="button"
                size={'sm'}
                onClick={() => fetchOllamaModels()}
                disabled={isLoadingOllama}
                variant="outline"
                className="whitespace-nowrap"
              >
                {isLoadingOllama ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Obteniendo...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Obtener Modelos
                  </>
                )}
              </Button>
            </div>
            {ollamaEndpointChanged && !error && (
              <Alert className="mt-3 border-[#485df4] dark:border-blue-600 bg-[#f0f2fe] dark:bg-blue-900/30">
                <AlertDescription className="text-[#2b3892] dark:text-blue-300">
                  Endpoint cambiado. Por favor haz clic en &quot;Obtener Modelos&quot; para cargar modelos del nuevo endpoint antes de guardar.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>

      {/* Models List Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-bold">Modelos Ollama Disponibles</h4>
          {lastFetchedEndpoint && allModelsCount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Usando:</span>
              <code className="px-2 py-1 bg-muted rounded text-xs">
                {lastFetchedEndpoint || 'http://localhost:11434'}
              </code>
            </div>
          )}
        </div>
        {allModelsCount > 0 && (
          <div className="mb-4">
            <Input
              placeholder="Buscar modelos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
        )}
        {isLoadingOllama ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin mb-2" />
            Cargando modelos...
          </div>
        ) : allModelsCount === 0 ? (
          <div className="space-y-3">
            {ollamaNotInstalled ? (
              <div className="space-y-4">
                <Alert className="border-[#ff4080] dark:border-red-700 bg-[#fff0f5] dark:bg-red-900/30">
                  <AlertDescription className="text-[#660020] dark:text-red-300">
                    Ollama no está instalado o no está ejecutándose. Por favor descarga e instala Ollama para usar modelos locales.
                  </AlertDescription>
                </Alert>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => invoke('open_external_url', { url: 'https://ollama.com/download' })}
                  className="w-full bg-[#3a4ac3] hover:bg-[#2b3892]"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Descargar Ollama
                </Button>
                <div className="text-sm text-muted-foreground text-center">
                  Después de instalar Ollama, reinicia esta aplicación y haz clic en &quot;Obtener Modelos&quot; para continuar.
                </div>
              </div>
            ) : (
              <>
                <Alert className="mb-4">
                  <AlertDescription>
                    {ollamaEndpointChanged
                      ? 'Endpoint cambiado. Haz clic en "Obtener Modelos" para cargar modelos del nuevo endpoint.'
                      : 'No se encontraron modelos. Descarga un modelo recomendado o haz clic en "Obtener Modelos" para cargar modelos Ollama disponibles.'}
                  </AlertDescription>
                </Alert>
                {!ollamaEndpointChanged && (
                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadRecommendedModel}
                      disabled={isDownloading('gemma3:1b')}
                      className="w-full"
                    >
                      {isDownloading('gemma3:1b') ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Descargando gemma3:1b...
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Descargar gemma3:1b (Recomendado, ~800MB)
                        </>
                      )}
                    </Button>

                    {isDownloading('gemma3:1b') && getProgress('gemma3:1b') !== undefined && (
                      <div className="bg-white dark:bg-gray-800 rounded-md border dark:border-gray-700 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-[#3a4ac3] dark:text-blue-400">Descargando gemma3:1b</span>
                          <span className="text-sm font-semibold text-[#3a4ac3] dark:text-blue-400">
                            {Math.round(getProgress('gemma3:1b')!)}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#d0d0d3] dark:bg-gray-600 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
                            style={{ width: `${getProgress('gemma3:1b')}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : !ollamaEndpointChanged && (
          <ScrollArea className="max-h-[calc(100vh-450px)] overflow-y-auto pr-4">
            {filteredModels.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No se encontraron modelos que coincidan con &quot;{searchQuery}&quot;. Intenta con otro término de búsqueda.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4">
                {filteredModels.map((model) => {
                  const progress = getProgress(model.name);
                  const modelIsDownloading = isDownloading(model.name);

                  return (
                    <div
                      key={model.id}
                      className={cn(
                        'bg-card p-2 m-0 rounded-md border transition-colors',
                        selectedModel === model.name
                          ? 'ring-1 ring-[#485df4] border-[#485df4] background-blue-100'
                          : 'hover:bg-muted/50',
                        !modelIsDownloading && 'cursor-pointer'
                      )}
                      onClick={() => {
                        if (!modelIsDownloading) {
                          setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }))
                        }
                      }}
                    >
                      <div>
                        <b className="font-bold">{model.name}&nbsp;</b>
                        <span className="text-muted-foreground">con un tamaño de </span>
                        <span className="font-mono font-bold text-sm">{model.size}</span>
                      </div>

                      {modelIsDownloading && progress !== undefined && (
                        <div className="mt-3 pt-3 border-t border-[#e7e7e9] dark:border-gray-700">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-[#3a4ac3] dark:text-blue-400">Descargando...</span>
                            <span className="text-sm font-semibold text-[#3a4ac3] dark:text-blue-400">{Math.round(progress)}%</span>
                          </div>
                          <div className="w-full h-2 bg-[#d0d0d3] dark:bg-gray-600 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </>
  );
}
