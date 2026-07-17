import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Lock, Unlock, Save, Loader2, CheckCircle } from 'lucide-react';
import { ModelManager } from '@/components/models/WhisperModelManager';
import { ParakeetModelManager } from '@/components/models/ParakeetModelManager';
import { MoonshineModelManager } from '@/components/models/MoonshineModelManager';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { CanaryAPI } from '@/lib/canary';
import type { TranscriptModelProps } from '@/types/transcript';

export type { TranscriptModelProps };

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    // Canary es dev-only: evaluación A/B contra Parakeet antes de decidir default.
    const { isAdmin } = useUserRole();
    const [canaryBusy, setCanaryBusy] = useState<boolean>(false);
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [selectedWhisperModel, setSelectedWhisperModel] = useState<string>(transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : 'small');
    const [selectedParakeetModel, setSelectedParakeetModel] = useState<string>(transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : 'parakeet-tdt-0.6b-v3-int8');
    const [selectedMoonshineModel, setSelectedMoonshineModel] = useState<string>(transcriptModelConfig.provider === 'moonshine' ? transcriptModelConfig.model : 'moonshine-base');
    const [selectedLanguage, setSelectedLanguage] = useState<string>(transcriptModelConfig.language || 'es-419');
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

    // Save transcript configuration
    const handleSaveConfig = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await invoke('api_save_transcript_config', {
                provider: transcriptModelConfig.provider,
                model: transcriptModelConfig.model,
                apiKey: apiKey || null,
                language: transcriptModelConfig.provider === 'deepgram' ? selectedLanguage : null,
            });

            // CRITICAL: Update the global ConfigContext state with the new apiKey and language
            // This ensures useRecordingStart sees the updated values immediately
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                apiKey: apiKey || null,
                language: transcriptModelConfig.provider === 'deepgram' ? selectedLanguage : undefined,
            });

            setSaveSuccess(true);
            toast.success('Configuración de transcripción guardada', {
                description: `Proveedor: ${transcriptModelConfig.provider}, Modelo: ${transcriptModelConfig.model}`,
            });
            // Reset success indicator after 2 seconds
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            console.error('Error saving transcript config:', err);
            toast.error('Error al guardar configuración', {
                description: String(err),
            });
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet' || transcriptModelConfig.provider === 'moonshine') {
            setApiKey(null);
        }
    }, [transcriptModelConfig.provider]);

    // Sync language state when config changes (e.g., on initial load)
    useEffect(() => {
        if (transcriptModelConfig.language) {
            setSelectedLanguage(transcriptModelConfig.language);
        }
    }, [transcriptModelConfig.language]);

    const fetchApiKey = async (provider: string) => {
        try {

            const data = await invoke('api_get_transcript_api_key', { provider }) as string;

            setApiKey(data || '');
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };
    const modelOptions = {
        localWhisper: [selectedWhisperModel],
        parakeet: [selectedParakeetModel],
        moonshine: [selectedMoonshineModel],
        canary: ['canary-1b-flash-int8'],
        deepgram: ['nova-3', 'nova-2', 'nova-2-phonecall', 'nova-2-meeting'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['llama-3.3-70b-versatile'],
        openai: ['gpt-4o'],
    };

    const deepgramLanguageOptions = [
        { value: 'es-419', label: 'Español Latinoamericano (Recomendado)' },
        { value: 'es', label: 'Español (España)' },
        { value: 'en', label: 'Inglés' },
        { value: 'multi', label: 'Multilingüe (auto-detect)' },
    ];
    const requiresApiKey = transcriptModelConfig.provider === 'elevenLabs' || transcriptModelConfig.provider === 'openai' || transcriptModelConfig.provider === 'groq';

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        setSelectedWhisperModel(modelName);
        if (transcriptModelConfig.provider === 'localWhisper') {
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                model: modelName
            });
            // Close modal after selection
            if (onModelSelect) {
                onModelSelect();
            }
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setSelectedParakeetModel(modelName);
        if (transcriptModelConfig.provider === 'parakeet') {
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                model: modelName
            });
            // Close modal after selection
            if (onModelSelect) {
                onModelSelect();
            }
        }
    };

    const handleCanaryDownload = async () => {
        setCanaryBusy(true);
        try {
            await CanaryAPI.init();
            await CanaryAPI.downloadModel('canary-1b-flash-int8');
            toast.success('Descarga de Canary completada o en curso', {
                description: 'Usa "Verificar estado" para confirmar que el modelo está listo.',
            });
        } catch (err) {
            toast.error('No se pudo descargar el modelo Canary', { description: String(err) });
        } finally {
            setCanaryBusy(false);
        }
    };

    const handleCanaryVerify = async () => {
        setCanaryBusy(true);
        try {
            await CanaryAPI.init();
            const model = await CanaryAPI.validateModelReady();
            toast.success('Canary listo para transcribir', { description: model });
        } catch (err) {
            toast.error('Canary no está listo', { description: String(err) });
        } finally {
            setCanaryBusy(false);
        }
    };

    const handleMoonshineModelSelect = (modelName: string) => {
        setSelectedMoonshineModel(modelName);
        if (transcriptModelConfig.provider === 'moonshine') {
            setTranscriptModelConfig({
                ...transcriptModelConfig,
                model: modelName
            });
            // Close modal after selection
            if (onModelSelect) {
                onModelSelect();
            }
        }
    };

    return (
        <div>
            <div>
                {/* <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-[#000000] dark:text-white">Transcript Settings</h3>
                </div> */}
                <div className="space-y-4 pb-6">
                    <div>
                        <Label className="block text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-1">
                            Modelo de Transcripción
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={transcriptModelConfig.provider}
                                onValueChange={(value) => {
                                    const provider = value as TranscriptModelProps['provider'];
                                    const newModel = provider === 'localWhisper' ? selectedWhisperModel : modelOptions[provider][0];
                                    setTranscriptModelConfig({ ...transcriptModelConfig, provider, model: newModel });
                                    if (provider !== 'localWhisper') {
                                        fetchApiKey(provider);
                                    }
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4]'>
                                    <SelectValue placeholder="Seleccionar proveedor" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="deepgram">☁️ Deepgram (Recomendado - Nube)</SelectItem>
                                    <SelectItem value="parakeet">⚡ Parakeet (Local - Tiempo Real)</SelectItem>
                                    <SelectItem value="moonshine">🌙 Moonshine (Local - Ultra Rápido)</SelectItem>
                                    <SelectItem value="localWhisper">🏠 Whisper Local (Alta Precisión)</SelectItem>
                                    {isAdmin && (
                                        <SelectItem value="canary">🐦 Canary (Dev - Mejor Español)</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>

                            {transcriptModelConfig.provider !== 'localWhisper' && transcriptModelConfig.provider !== 'parakeet' && transcriptModelConfig.provider !== 'moonshine' && (
                                <Select
                                    value={transcriptModelConfig.model}
                                    onValueChange={(value) => {
                                        const model = value as TranscriptModelProps['model'];
                                        setTranscriptModelConfig({ ...transcriptModelConfig, model });
                                    }}
                                >
                                    <SelectTrigger className='focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4]'>
                                        <SelectValue placeholder="Seleccionar modelo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {modelOptions[transcriptModelConfig.provider].map((model) => (
                                            <SelectItem key={model} value={model}>{model}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                        </div>
                        {transcriptModelConfig.provider === 'deepgram' && (
                            <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 mx-1">
                                Deepgram usa autenticacion automatica. Solo necesitas iniciar sesion con Google.
                            </p>
                        )}
                    </div>

                    {/* Language selector for Deepgram */}
                    {transcriptModelConfig.provider === 'deepgram' && (
                        <div>
                            <Label className="block text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-1">
                                Idioma de Transcripción
                            </Label>
                            <div className="mx-1">
                                <Select
                                    value={selectedLanguage}
                                    onValueChange={(value) => {
                                        setSelectedLanguage(value);
                                        setTranscriptModelConfig({
                                            ...transcriptModelConfig,
                                            language: value
                                        });
                                    }}
                                >
                                    <SelectTrigger className='focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4]'>
                                        <SelectValue placeholder="Seleccionar idioma" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {deepgramLanguageOptions.map((lang) => (
                                            <SelectItem key={lang.value} value={lang.value}>
                                                {lang.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 mx-1">
                                Nova-3 soporta español latinoamericano (es-419) con alta precision.
                            </p>
                        </div>
                    )}

                    {transcriptModelConfig.provider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={selectedWhisperModel}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {transcriptModelConfig.provider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={selectedParakeetModel}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {transcriptModelConfig.provider === 'moonshine' && (
                        <div className="mt-6">
                            <MoonshineModelManager
                                selectedModel={selectedMoonshineModel}
                                onModelSelect={handleMoonshineModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {transcriptModelConfig.provider === 'canary' && isAdmin && (
                        <div className="mt-4 rounded-md border border-dashed border-[#485df4]/40 p-3 space-y-2">
                            <p className="text-sm font-medium text-[#3a3a3c] dark:text-gray-200">
                                🐦 Canary Flash (dev-only) — mejor español medido, idioma forzado a es
                            </p>
                            <p className="text-xs text-[#6b6b6e] dark:text-gray-400">
                                Modelo canary-1b-flash-int8 (~1GB). Descárgalo una vez, verifica el estado y
                                graba normal para el A/B contra Parakeet. Los usuarios regulares no ven esta opción.
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" variant="outline" disabled={canaryBusy} onClick={handleCanaryDownload}>
                                    {canaryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Descargar modelo'}
                                </Button>
                                <Button size="sm" variant="outline" disabled={canaryBusy} onClick={handleCanaryVerify}>
                                    Verificar estado
                                </Button>
                            </div>
                        </div>
                    )}

                    {requiresApiKey && (
                        <div>
                            <Label className="block text-sm font-medium text-[#3a3a3c] dark:text-gray-200 mb-1">
                                Clave API
                            </Label>
                            <div className="relative mx-1">
                                <Input
                                    type={showApiKey ? "text" : "password"}
                                    className={`pr-24 focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4] ${isApiKeyLocked ? 'bg-[#e7e7e9] dark:bg-gray-700 cursor-not-allowed' : ''
                                        }`}
                                    value={apiKey || ''}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    disabled={isApiKeyLocked}
                                    onClick={handleInputClick}
                                    placeholder="Ingresa tu clave API"
                                />
                                {isApiKeyLocked && (
                                    <div
                                        onClick={handleInputClick}
                                        className="absolute inset-0 flex items-center justify-center bg-[#e7e7e9] dark:bg-gray-700 bg-opacity-50 rounded-md cursor-not-allowed"
                                    />
                                )}
                                <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                        className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-[#ff0050]' : ''
                                            }`}
                                        title={isApiKeyLocked ? "Desbloquear para editar" : "Bloquear para evitar edición"}
                                    >
                                        {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 mx-1">
                                Obtén tu clave API desde <a href="https://console.deepgram.com/" target="_blank" rel="noopener noreferrer" className="text-[#3a4ac3] hover:underline">Consola de Deepgram</a>
                            </p>
                        </div>
                    )}

                    {/* Save Button */}
                    <div className="pt-4 mx-1">
                        <Button
                            onClick={handleSaveConfig}
                            disabled={isSaving}
                            className="w-full bg-[#000000] hover:bg-[#1a1a1a] text-white"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Guardando...
                                </>
                            ) : saveSuccess ? (
                                <>
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    ¡Guardado!
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Guardar Configuración
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}








