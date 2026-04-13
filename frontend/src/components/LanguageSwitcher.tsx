'use client'

import { useI18n } from '@/contexts/I18nContext'
import { LANGUAGE_NAMES, Language } from '@/i18n'

/**
 * Componente de ejemplo para cambiar idioma
 * Demuestra cómo usar el sistema i18n
 *
 * Uso:
 * <LanguageSwitcher />
 */
export function LanguageSwitcher() {
  const { language, setLanguage, availableLanguages } = useI18n()

  return (
    <div className="flex gap-2">
      {availableLanguages.map((lang: Language) => (
        <button
          key={lang}
          onClick={() => setLanguage(lang)}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            language === lang
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'
          }`}
          aria-label={`Switch to ${LANGUAGE_NAMES[lang]}`}
        >
          {LANGUAGE_NAMES[lang]}
        </button>
      ))}
    </div>
  )
}

/**
 * Componente de ejemplo: Dropdown selector de idioma
 */
export function LanguageSelectorDropdown() {
  const { language, setLanguage, availableLanguages } = useI18n()

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      className="px-3 py-2 border rounded dark:bg-gray-800 dark:text-white"
      aria-label="Select language"
    >
      {availableLanguages.map((lang: Language) => (
        <option key={lang} value={lang}>
          {LANGUAGE_NAMES[lang]}
        </option>
      ))}
    </select>
  )
}
