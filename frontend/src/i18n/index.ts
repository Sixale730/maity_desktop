import es from './translations/es.json'
import en from './translations/en.json'
import pt from './translations/pt.json'

export type Language = 'es' | 'en' | 'pt'

export const AVAILABLE_LANGUAGES: Language[] = ['es', 'en', 'pt']
export const LANGUAGE_NAMES: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
}

export const translations = {
  es,
  en,
  pt,
} as const

export type TranslationKeys = typeof es

/**
 * Obtiene valor anidado usando notación de puntos
 * Ejemplo: t('app.title') → "Maity Desktop"
 */
export function getTranslation(
  obj: Record<string, unknown>,
  path: string
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = path
    .split('.')
    .reduce<unknown>((current, key) => (current as Record<string, unknown>)?.[key], obj);
  return (typeof result === 'string' ? result : `[${path}]`);
}
