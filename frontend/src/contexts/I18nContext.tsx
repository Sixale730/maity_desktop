'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import {
  Language,
  AVAILABLE_LANGUAGES,
  translations,
  getTranslation,
  TranslationKeys,
} from '@/i18n'

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  availableLanguages: Language[]
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('maity-language') as Language) || 'es'
    }
    return 'es'
  })

  useEffect(() => {
    localStorage.setItem('maity-language', language)
    document.documentElement.lang = language
  }, [language])

  const setLanguage = (lang: Language) => {
    if (AVAILABLE_LANGUAGES.includes(lang)) {
      setLanguageState(lang)
    }
  }

  const t = (key: string): string => {
    const currentTranslations = translations[language]
    return getTranslation(currentTranslations, key)
  }

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
        t,
        availableLanguages: AVAILABLE_LANGUAGES,
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n debe usarse dentro de I18nProvider')
  }
  return context
}
