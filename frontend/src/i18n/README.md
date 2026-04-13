# Sistema i18n Ligero - Maity Desktop

Sistema de internacionalización minimalista sin dependencias externas.

## Inicio Rápido

### Usar en un Componente

```tsx
'use client'
import { useI18n } from '@/contexts/I18nContext'

export function MiComponente() {
  const { t, language, setLanguage } = useI18n()

  return (
    <div>
      <h1>{t('app.title')}</h1>
      <p>Idioma actual: {language}</p>
      <button onClick={() => setLanguage('en')}>English</button>
    </div>
  )
}
```

## Archivos Principales

- `index.ts` - Tipos, constantes y helpers
- `translations/es.json` - Español (default)
- `translations/en.json` - English
- `translations/pt.json` - Português
- `../contexts/I18nContext.tsx` - Provider React + hook
- `../components/LanguageSwitcher.tsx` - Componentes de ejemplo

## Estadísticas

- **Líneas de código**: ~130 (código) + 200 (traducciones JSON)
- **Dependencias npm**: 0 (cero)
- **Tamaño bundle**: ~2KB (comprimido)

## API

```typescript
// Hook
const { language, setLanguage, t, availableLanguages } = useI18n()

// Cambiar idioma
setLanguage('en')  // 'es', 'en', 'pt'

// Obtener traducción
t('clave.anidada')  // notación de puntos

// Constantes
AVAILABLE_LANGUAGES  // ['es', 'en', 'pt']
LANGUAGE_NAMES       // { es: 'Español', en: 'English', pt: 'Português' }
```

## Agregar Idiomas

1. Crear `translations/{codigo}.json`
2. Actualizar tipo `Language` en `index.ts`
3. Agregar al array `AVAILABLE_LANGUAGES`
4. Agregar a `LANGUAGE_NAMES`
5. Agregar al objeto `translations`

## Características

- Persistencia automática en localStorage
- Actualiza `<html lang>` al cambiar idioma
- Notación de puntos para claves anidadas
- Fallback seguro para claves faltantes
- Completamente tipado con TypeScript
- Compatible con SSR

## Notas

- Importa JSON directamente (Next.js + TypeScript soportan)
- Usando Context API en lugar de props drilling
- Sin re-renders innecesarios (estado local en contexto)
