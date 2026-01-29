import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Globe } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';

export interface Language {
  code: string;
  name: string;
}

// ISO 639-1 language codes supported by Whisper
// Spanish is first (after auto options) as it's the default for our users
const LANGUAGES: Language[] = [
  { code: 'es', name: 'Español (Predeterminado)' },
  { code: 'en', name: 'Inglés' },
  { code: 'auto', name: 'Detección Automática (Idioma Original)' },
  { code: 'auto-translate', name: 'Detección Automática (Traducir a Inglés)' },
  { code: 'zh', name: 'Chino' },
  { code: 'de', name: 'Alemán' },
  { code: 'ru', name: 'Ruso' },
  { code: 'ko', name: 'Coreano' },
  { code: 'fr', name: 'Francés' },
  { code: 'ja', name: 'Japonés' },
  { code: 'pt', name: 'Portugués' },
  { code: 'tr', name: 'Turco' },
  { code: 'pl', name: 'Polaco' },
  { code: 'ca', name: 'Catalán' },
  { code: 'nl', name: 'Holandés' },
  { code: 'ar', name: 'Árabe' },
  { code: 'sv', name: 'Sueco' },
  { code: 'it', name: 'Italiano' },
  { code: 'id', name: 'Indonesio' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fi', name: 'Finlandés' },
  { code: 'vi', name: 'Vietnamita' },
  { code: 'he', name: 'Hebreo' },
  { code: 'uk', name: 'Ucraniano' },
  { code: 'el', name: 'Griego' },
  { code: 'ms', name: 'Malayo' },
  { code: 'cs', name: 'Checo' },
  { code: 'ro', name: 'Rumano' },
  { code: 'da', name: 'Danés' },
  { code: 'hu', name: 'Húngaro' },
  { code: 'ta', name: 'Tamil' },
  { code: 'no', name: 'Noruego' },
  { code: 'th', name: 'Tailandés' },
  { code: 'ur', name: 'Urdu' },
  { code: 'hr', name: 'Croata' },
  { code: 'bg', name: 'Búlgaro' },
  { code: 'lt', name: 'Lituano' },
  { code: 'la', name: 'Latín' },
  { code: 'mi', name: 'Maori' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'cy', name: 'Galés' },
  { code: 'sk', name: 'Eslovaco' },
  { code: 'te', name: 'Telugu' },
  { code: 'fa', name: 'Persa' },
  { code: 'lv', name: 'Letón' },
  { code: 'bn', name: 'Bengalí' },
  { code: 'sr', name: 'Serbio' },
  { code: 'az', name: 'Azerbaiyano' },
  { code: 'sl', name: 'Esloveno' },
  { code: 'kn', name: 'Canarés' },
  { code: 'et', name: 'Estonio' },
  { code: 'mk', name: 'Macedonio' },
  { code: 'br', name: 'Bretón' },
  { code: 'eu', name: 'Euskera' },
  { code: 'is', name: 'Islandés' },
  { code: 'hy', name: 'Armenio' },
  { code: 'ne', name: 'Nepalí' },
  { code: 'mn', name: 'Mongol' },
  { code: 'bs', name: 'Bosnio' },
  { code: 'kk', name: 'Kazajo' },
  { code: 'sq', name: 'Albanés' },
  { code: 'sw', name: 'Suajili' },
  { code: 'gl', name: 'Gallego' },
  { code: 'mr', name: 'Maratí' },
  { code: 'pa', name: 'Punyabí' },
  { code: 'si', name: 'Cingalés' },
  { code: 'km', name: 'Jemer' },
  { code: 'sn', name: 'Shona' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'so', name: 'Somalí' },
  { code: 'af', name: 'Afrikáans' },
  { code: 'oc', name: 'Occitano' },
  { code: 'ka', name: 'Georgiano' },
  { code: 'be', name: 'Bielorruso' },
  { code: 'tg', name: 'Tayiko' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'gu', name: 'Guyaratí' },
  { code: 'am', name: 'Amárico' },
  { code: 'yi', name: 'Yidis' },
  { code: 'lo', name: 'Lao' },
  { code: 'uz', name: 'Uzbeko' },
  { code: 'fo', name: 'Feroés' },
  { code: 'ht', name: 'Criollo Haitiano' },
  { code: 'ps', name: 'Pastún' },
  { code: 'tk', name: 'Turcomano' },
  { code: 'nn', name: 'Noruego Nynorsk' },
  { code: 'mt', name: 'Maltés' },
  { code: 'sa', name: 'Sánscrito' },
  { code: 'lb', name: 'Luxemburgués' },
  { code: 'my', name: 'Birmano' },
  { code: 'bo', name: 'Tibetano' },
  { code: 'tl', name: 'Tagalo' },
  { code: 'mg', name: 'Malgache' },
  { code: 'as', name: 'Asamés' },
  { code: 'tt', name: 'Tártaro' },
  { code: 'haw', name: 'Hawaiano' },
  { code: 'ln', name: 'Lingala' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ba', name: 'Baskir' },
  { code: 'jw', name: 'Javanés' },
  { code: 'su', name: 'Sundanés' },
];

interface LanguageSelectionProps {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  provider?: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
}

export function LanguageSelection({
  selectedLanguage,
  onLanguageChange,
  disabled = false,
  provider = 'localWhisper'
}: LanguageSelectionProps) {
  const [saving, setSaving] = useState(false);

  // Parakeet only supports auto-detection (doesn't support manual language selection)
  const isParakeet = provider === 'parakeet';
  const availableLanguages = isParakeet
    ? LANGUAGES.filter(lang => lang.code === 'auto' || lang.code === 'auto-translate')
    : LANGUAGES;

  const handleLanguageChange = async (languageCode: string) => {
    setSaving(true);
    try {
      // Save language preference to backend
      await invoke('set_language_preference', { language: languageCode });
      onLanguageChange(languageCode);
      console.log('Language preference saved:', languageCode);

      // Track language selection analytics
      const selectedLang = LANGUAGES.find(lang => lang.code === languageCode);
      await Analytics.track('language_selected', {
        language_code: languageCode,
        language_name: selectedLang?.name || 'Unknown',
        is_auto_detect: (languageCode === 'auto').toString(),
        is_auto_translate: (languageCode === 'auto-translate').toString()
      });

      // Show success toast
      const languageName = selectedLang?.name || languageCode;
      toast.success("Preferencia de idioma guardada", {
        description: `Idioma de transcripción configurado a ${languageName}`
      });
    } catch (error) {
      console.error('Error al guardar preferencia de idioma:', error);
      toast.error("Error al guardar preferencia de idioma", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  // Find the selected language name for display
  const selectedLanguageName = LANGUAGES.find(
    lang => lang.code === selectedLanguage
  )?.name || 'Detección Automática (Idioma Original)';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[#4a4a4c] dark:text-gray-300" />
          <h4 className="text-sm font-medium text-[#000000] dark:text-white">Idioma de Transcripción</h4>
        </div>
      </div>

      <div className="space-y-2">
        <select
          value={selectedLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          disabled={disabled || saving}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-[#d0d0d3] dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#485df4] focus:border-[#485df4] disabled:bg-[#f5f5f6] dark:disabled:bg-gray-700 disabled:text-[#6a6a6d] dark:disabled:text-gray-500 dark:text-white"
        >
          {availableLanguages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name}
              {language.code !== 'auto' && language.code !== 'auto-translate' && ` (${language.code})`}
            </option>
          ))}
        </select>

        {/* Aviso de limitación de idioma de Parakeet */}
        {isParakeet && (
          <div className="p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded text-amber-800 dark:text-amber-300">
            <p className="font-medium">ℹ️ Soporte de Idiomas de Parakeet</p>
            <p className="mt-1 text-xs">Parakeet actualmente solo soporta detección automática de idioma. La selección manual de idioma no está disponible. Usa Whisper si necesitas especificar un idioma particular.</p>
          </div>
        )}

        {/* Texto informativo */}
        <div className="text-xs space-y-2 pt-2">
          <p className="text-[#4a4a4c] dark:text-gray-300">
            <strong>Actual:</strong> {selectedLanguageName}
          </p>
          {selectedLanguage === 'auto' && (
            <div className="p-2 bg-[#f0f2fe] dark:bg-blue-900/30 border border-[#c0cbfb] dark:border-blue-700 rounded text-[#2b3892] dark:text-blue-300">
              <p className="font-medium">⚠️ La Detección Automática puede producir resultados incorrectos</p>
              <p className="mt-1">Para mejor precisión, selecciona tu idioma específico (ej., Español, Inglés, etc.)</p>
            </div>
          )}
          {selectedLanguage === 'auto-translate' && (
            <div className="p-2 bg-[#f0f2fe] dark:bg-blue-900/30 border border-[#c0cbfb] dark:border-blue-700 rounded text-[#1e2a6e] dark:text-blue-300">
              <p className="font-medium">🌐 Modo de Traducción Activo</p>
              <p className="mt-1">Todo el audio será traducido automáticamente al español. Ideal para reuniones multilingües donde necesitas salida en español.</p>
            </div>
          )}
          {selectedLanguage !== 'auto' && selectedLanguage !== 'auto-translate' && (
            <p className="text-[#4a4a4c] dark:text-gray-300">
              La transcripción será optimizada para <strong>{selectedLanguageName}</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
