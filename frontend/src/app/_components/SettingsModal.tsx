import type { ModelConfig } from "@/types/models";
import { PreferenceSettings } from "@/components/settings/PreferenceSettings";
import { DeviceSelection } from "@/components/recording/DeviceSelection";
import { LanguageSelection } from "@/components/transcript/LanguageSelection";
import { TranscriptSettings } from "@/components/transcript/TranscriptSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";

type modalType = "modelSettings" | "deviceSettings" | "languageSettings" | "modelSelector" | "errorAlert" | "chunkDropWarning";

/**
 * SettingsModals Component
 *
 * All settings modals consolidated into a single component.
 * Uses ConfigContext and RecordingStateContext internally - no prop drilling needed!
 */

interface SettingsModalsProps {
  modals: {
    modelSettings: boolean;
    deviceSettings: boolean;
    languageSettings: boolean;
    modelSelector: boolean;
    errorAlert: boolean;
    chunkDropWarning: boolean;
  };
  messages: {
    errorAlert: string;
    chunkDropWarning: string;
    modelSelector: string;
  };
  onClose: (name: modalType) => void;
}

export function SettingsModals({
  modals,
  messages,
  onClose,
}: SettingsModalsProps) {
  // Contexts
  const {
    modelConfig,
    setModelConfig,
    models,
    modelOptions,
    error,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    transcriptModelConfig,
    setTranscriptModelConfig,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
  } = useConfig();

  const { isRecording } = useRecordingState();

  return <>
    {/* Legacy Settings Modal */}
    {modals.modelSettings && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b">
            <h3 className="text-xl font-semibold text-[#000000] dark:text-white">Preferencias</h3>
            <button
              onClick={() => onClose("modelSettings")
              }
              className="text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* General Preferences Section */}
            <PreferenceSettings />

            {/* Divider */}
            <div className="border-t pt-8">
              <h4 className="text-lg font-semibold text-[#000000] dark:text-white mb-4">Configuración de Modelo IA</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-1">
                    Modelo de Resumen
                  </label>
                  <div className="flex space-x-2">
                    <select
                      className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-[#d0d0d3] dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      value={modelConfig.provider}
                      onChange={(e) => {
                        const provider = e.target.value as ModelConfig['provider'];
                        setModelConfig({
                          ...modelConfig,
                          provider,
                          model: modelOptions[provider][0]
                        });
                      }}
                    >
                      <option value="builtin-ai">IA Integrada</option>
                      <option value="claude">Claude</option>
                      <option value="groq">Groq</option>
                      <option value="ollama">Ollama</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                    </select>

                    <select
                      className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-[#d0d0d3] dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      value={modelConfig.model}
                      onChange={(e) => setModelConfig((prev: ModelConfig) => ({ ...prev, model: e.target.value }))}
                    >
                      {modelOptions[modelConfig.provider].map((model: string) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {modelConfig.provider === 'ollama' && (
                  <div>
                    <h4 className="text-lg font-bold mb-4">Modelos Ollama Disponibles</h4>
                    {error && (
                      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        {error}
                      </div>
                    )}
                    <div className="grid gap-4 max-h-[400px] overflow-y-auto pr-2">
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className={`bg-white p-4 rounded-lg shadow cursor-pointer transition-colors ${modelConfig.model === model.name ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-[#f5f5f6] dark:hover:bg-gray-700'
                            }`}
                          onClick={() => setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }))}
                        >
                          <h3 className="font-bold">{model.name}</h3>
                          <p className="text-[#4a4a4c] dark:text-gray-300">Tamaño: {model.size}</p>
                          <p className="text-[#4a4a4c] dark:text-gray-300">Modificado: {model.modified}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t p-6 flex justify-end">
            <button
              onClick={() => onClose('modelSettings')}
              className="px-4 py-2 text-sm font-medium text-white bg-[#3a4ac3] rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Device Settings Modal */}
    {modals.deviceSettings && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-[#000000] dark:text-white">Configuración de Dispositivos de Audio</h3>
            <button
              onClick={() => onClose('deviceSettings')}
              className="text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <DeviceSelection
            selectedDevices={selectedDevices}
            onDeviceChange={setSelectedDevices}
            disabled={isRecording}
          />

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => {
                const micDevice = selectedDevices.micDevice || 'Predeterminado';
                const systemDevice = selectedDevices.systemDevice || 'Predeterminado';
                toast.success("Dispositivos seleccionados", {
                  description: `Micrófono: ${micDevice}, Audio del Sistema: ${systemDevice}`
                });
                onClose('deviceSettings');
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-[#3a4ac3] rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Language Settings Modal */}
    {modals.languageSettings && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-[#000000] dark:text-white">Configuración de Idioma</h3>
            <button
              onClick={() => onClose('languageSettings')}
              className="text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <LanguageSelection
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            disabled={isRecording}
            provider={transcriptModelConfig.provider}
          />

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => onClose('languageSettings')}
              className="px-4 py-2 text-sm font-medium text-white bg-[#3a4ac3] rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Model Selection Modal */}
    {modals.modelSelector && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full mx-4 shadow-xl max-h-[90vh] flex flex-col">
          {/* Fixed Header */}
          <div className="flex justify-between items-center p-6 pb-4 border-b border-[#e7e7e9] dark:border-gray-700">
            <h3 className="text-lg font-semibold text-[#000000] dark:text-white">
              {messages.modelSelector ? 'Configuración de Reconocimiento de Voz Requerida' : 'Configuración del Modelo de Transcripción'}
            </h3>
            <button
              onClick={() => onClose('modelSelector')}
              className="text-[#6a6a6d] dark:text-gray-400 hover:text-[#3a3a3c] dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            <TranscriptSettings
              transcriptModelConfig={transcriptModelConfig}
              setTranscriptModelConfig={setTranscriptModelConfig}
              onModelSelect={() => onClose('modelSelector')}
            />
          </div>

          {/* Fixed Footer */}
          <div className="p-6 pt-4 border-t border-[#e7e7e9] dark:border-gray-700 flex items-center justify-between">
            {/* Confidence Indicator Toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showConfidenceIndicator}
                  onChange={(e) => toggleConfidenceIndicator(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#d0d0d3] dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-[#d0d0d3] dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3a4ac3]"></div>
              </label>
              <div>
                <p className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">Mostrar Indicadores de Confianza</p>
                <p className="text-xs text-[#6a6a6d] dark:text-gray-400">Muestra puntos de colores indicando la calidad de confianza de la transcripción</p>
              </div>
            </div>

            <button
              onClick={() => onClose('modelSelector')}
              className="px-4 py-2 text-sm font-medium text-[#3a3a3c] dark:text-gray-200 bg-[#e7e7e9] rounded-md hover:bg-[#d0d0d3] dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              {messages.modelSelector ? 'Cancelar' : 'Listo'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Error Alert Modal */}
    {modals.errorAlert && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <Alert className="max-w-md mx-4 border-red-200 bg-white dark:bg-gray-900 shadow-xl">
          <AlertTitle className="text-red-800">Grabación Detenida</AlertTitle>
          <AlertDescription className="text-red-700">
            {messages.errorAlert}
            <button
              onClick={() => onClose('errorAlert')}
              className="ml-2 text-red-600 hover:text-red-800 underline"
            >
              Cerrar
            </button>
          </AlertDescription>
        </Alert>
      </div>
    )}

    {/* Chunk Drop Warning Modal */}
    {modals.chunkDropWarning && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <Alert className="max-w-lg mx-4 border-yellow-200 bg-white dark:bg-gray-900 shadow-xl">
          <AlertTitle className="text-yellow-800">Advertencia de Rendimiento de Transcripción</AlertTitle>
          <AlertDescription className="text-yellow-700">
            {messages.chunkDropWarning}
            <button
              onClick={() => onClose('chunkDropWarning')}
              className="ml-2 text-yellow-600 hover:text-yellow-800 underline"
            >
              Cerrar
            </button>
          </AlertDescription>
        </Alert>
      </div>
    )}
  </>
}
