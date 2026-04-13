# Sistema i18n - Guía de Uso

Maity Desktop incluye un sistema ligero de internacionalización sin dependencias pesadas.

## Configuración

El sistema se inicializa automáticamente en `layout.tsx` con `<I18nProvider>`. No requiere configuración adicional.

## Uso en Componentes

### Acceder a Traducciones

```tsx
'use client'
import { useI18n } from '@/contexts/I18nContext'

export function MiComponente() {
  const { t, language, setLanguage } = useI18n()

  return (
    <div>
      <h1>{t('app.title')}</h1>
      <p>{t('recording.start')}</p>
      <span>Idioma actual: {language}</span>
    </div>
  )
}
```

### Cambiar Idioma

```tsx
const { setLanguage } = useI18n()

// Cambiar a inglés
<button onClick={() => setLanguage('en')}>English</button>

// Cambiar a portugués
<button onClick={() => setLanguage('pt')}>Português</button>

// Cambiar a español (default)
<button onClick={() => setLanguage('es')}>Español</button>
```

## Agregar Nuevas Claves de Traducción

1. Abrir los tres archivos de traducción en `src/i18n/translations/`:
   - `es.json` (Español)
   - `en.json` (English)
   - `pt.json` (Português)

2. Agregar la nueva clave en la estructura anidada:

```json
{
  "myFeature": {
    "button": "Mi botón",
    "title": "Mi título"
  }
}
```

3. Usar en componente:
```tsx
const { t } = useI18n()
t('myFeature.button')  // "Mi botón"
t('myFeature.title')   // "Mi título"
```

## Idiomas Disponibles

- `es` - Español (default)
- `en` - English
- `pt` - Português

## Persistencia

El idioma seleccionado se guarda automáticamente en localStorage bajo la clave `maity-language`. Se restaura al recargar la app.

## Notación de Puntos

Las claves de traducción usan notación de puntos para acceder a valores anidados:

```
t('app.title')      → Accede a translations[language]['app']['title']
t('common.cancel')  → Accede a translations[language]['common']['cancel']
```

Si una clave no existe, retorna `[clave.no.encontrada]` en lugar de fallar.

## Tipos TypeScript

El contexto i18n está completamente tipado:

```tsx
interface I18nContextType {
  language: Language                    // 'es' | 'en' | 'pt'
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  availableLanguages: Language[]
}
```

## Ejemplo Completo: Selector de Idioma

```tsx
'use client'
import { useI18n } from '@/contexts/I18nContext'
import { LANGUAGE_NAMES } from '@/i18n'

export function LanguageSwitcher() {
  const { language, setLanguage, availableLanguages } = useI18n()

  return (
    <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
      {availableLanguages.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_NAMES[lang]}
        </option>
      ))}
    </select>
  )
}
```
