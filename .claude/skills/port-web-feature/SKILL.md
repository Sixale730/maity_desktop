---
name: port-web-feature
description: Portar un feature del repo web (Sixale730/maity) al desktop usando el approach "zero-drift" (copia tal cual + adapter shims). Úsalo cuando el user te pida "aplicar handoff de la web", "portar X feature del web", "espejar la web", o cuando llegue un zip con estructura adapters/ + patches/.
---

# port-web-feature — Portar un feature de la web al desktop sin drift

## Cuándo invocar esta skill

- El user pide aplicar un handoff con estructura `adapters/` + `patches/` (típicamente `handoff_*_chat/`, `handoff_*_dashboard/`, etc.)
- El user dice "trae X de la web", "porta X feature de Sixale730/maity"
- Llega un nuevo zip de diseño tipo `Maity (N).zip` que dice "Estrategia: copiamos el código real de la web tal cual"

**NO invoques esta skill cuando**:
- El handoff trae componentes ya re-escritos (zips v1/v2 antiguos sin `adapters/`)
- El user quiere una traducción manual o tokenización personalizada
- El feature ya está en el desktop y solo necesita un patch puntual

## Filosofía

**Cero drift entre web y desktop**: copia el código real de `Sixale730/maity@main` tal cual. Los imports que la web usa (`useUser`, `useLanguage`, `MaityLogo`, `useNavigate`) se resuelven con **adapter shims** en el desktop. Cuando la web cambia, se vuelve a copiar — no se re-traduce.

## Pre-requisitos antes de aplicar

1. **El handoff está extraído** en una carpeta accesible (típicamente `C:/Users/jagv1/AppData/Local/Temp/maityN/handoff_*/`)
2. **`gh` o `git` están disponibles** para clonar el repo de la web
3. **El user confirmó** que quiere el pivote (puede invalidar trabajo previo en el feature)
4. **No hay instancia de la app corriendo** (verifica con `tasklist | grep maity`)

## Pasos de aplicación (orden estricto)

### 1. Clonar el repo de la web a un folder temporal

```bash
mkdir -p _web_ref
git clone --depth 1 --branch main https://github.com/Sixale730/maity.git _web_ref/maity
```

Si `gh` está autenticado, también funciona: `gh repo clone Sixale730/maity _web_ref/maity -- --depth 1 --branch main`.

### 2. Copiar archivos de la web (TAL CUAL — sin modificar)

Lee la sección "Fuente de verdad" del `README.md` del handoff para saber exactamente qué carpetas copiar. Patrón típico:

```bash
WEB=_web_ref/maity/src
DESKTOP=frontend/src

# Feature: solo components + utils + types + hooks nuevos
cp -R $WEB/features/<feature>/components/* $DESKTOP/features/<feature>/components/
cp -R $WEB/features/<feature>/utils/*      $DESKTOP/features/<feature>/utils/
cp    $WEB/features/<feature>/types.ts     $DESKTOP/features/<feature>/types.ts

# Shell (si el handoff lo incluye)
cp -R $WEB/shared/components/shell-vX/* $DESKTOP/shared/components/shell-vX/
```

**Qué NO copiar**:
- `services/` del feature — el desktop suele tener su propia versión (Supabase client distinto). Aplica el patch puntual del handoff a este archivo.
- Hooks que ya existen en el desktop (`useThreads`, `useMessages`, `useMemories` típicamente). Solo copia hooks NUEVOS (ej. `useThreadLens`).

### 3. Borrar componentes obsoletos del desktop

Lista los archivos que el handoff dice borrar. **Antes de borrar**, verifica con `grep` que ningún archivo fuera del feature los importe:

```bash
grep -rn "<componente1>\|<componente2>" $DESKTOP --include="*.tsx" --include="*.ts" | grep -v "features/<feature>"
```

Si grep devuelve resultados → **PARA, reporta los archivos y pregunta al user**. No borres sin permiso.

### 4. Pegar los adapter shims

Los shims viven en `handoff_*/adapters/` y se copian a paths específicos del desktop:

| Shim | Destino típico | Propósito |
|---|---|---|
| `UserContext.tsx` | `src/contexts/UserContext.tsx` | Mapea `useAuth().maityUser` (desktop) → `useUser().userProfile` (web). Ajusta el mapeo si MaityUser tiene `first_name`/`last_name` en lugar de `name`. |
| `LanguageContext.tsx` | `src/contexts/LanguageContext.tsx` | Stub de i18n. La web usa `useLanguage()`/`t()`; el desktop usa strings hardcoded en español. El shim devuelve `t = (k) => k` para no romper. |
| `MaityLogo.tsx` | `src/shared/components/MaityLogo.tsx` | Logo SVG inline. |
| `AdminViewRoleSelector.tsx` | `src/shared/components/AdminViewRoleSelector.tsx` | Si el desktop no tiene admin views, devuelve `null`. |
| `LazyVoxelAvatar.tsx` | `src/features/avatar/components/LazyVoxelAvatar.tsx` | Avatar voxel. Stub que devuelve un círculo placeholder si el desktop no tiene voxel renderer. |
| `maity-shared.ts` | `src/shared/maity-shared.ts` | Stub del package `@maity/shared` que la web usa. Tipos compartidos + helpers. |
| `router-compat.ts` | `src/lib/router-compat.ts` | Shim de `react-router-dom`: `useNavigate()` → `router.push()` de `next/navigation`. **Esencial** para que los archivos de la web compilen sin instalar react-router. |
| `env.ts` | `src/lib/env.ts` | **NO copies si el desktop ya tiene su config de endpoint** — verifica primero. |

### 5. Agregar path alias `@maity/shared` en tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@maity/shared": ["./src/shared/maity-shared.ts"],
      "@/*": ["./src/*"]
    }
  }
}
```

Verifica que `@/*` ya esté ahí. Si falta, agrégalo.

### 6. Find-and-replace `react-router-dom` → `@/lib/router-compat`

Solo los archivos copiados de la web que importan `useNavigate` de `react-router-dom`:

```bash
# Identifica primero qué archivos lo usan:
grep -rln "from 'react-router-dom'" $DESKTOP --include="*.tsx"

# Aplica el reemplazo (Git Bash en Windows: usa -i.bak luego rm .bak):
sed -i.bak "s|from 'react-router-dom'|from '@/lib/router-compat'|g" <archivo>
rm <archivo>.bak
```

**Verifica que no quede ningún `react-router-dom`** en el desktop:
```bash
grep -rn "react-router-dom" $DESKTOP --include="*.tsx" --include="*.ts"
# Debe estar vacío.
```

### 6.5. Pre-flight: validar Tailwind config (CRITICO — agregado tras incidente mayo 2026)

Antes de copiar/parchar archivos del web, verifica que el desktop no tenga configs duplicados de Tailwind o PostCSS:

```bash
ls frontend/tailwind.config.*    # Debe haber SOLO uno (preferentemente .ts)
ls frontend/postcss.config.*     # Debe haber SOLO uno
```

Si hay `.js` y `.ts` ambos: **Tailwind 3 lee el `.js` primero por orden alfabético del loader**. El `.ts` (que cubre `src/features/**` y `src/shared/**`) es ignorado. Síntomas:
- Clases arbitrary del feature copiado nunca aparecen en el CSS purgado (`max-w-[760px]`, `text-[22px]`, `rounded-[14px]`, etc.)
- Tokens de chat invisibles (`bg-card-hi/40` no aplica)
- Fonts `font-geist` caen a `system-ui`/Segoe UI
- Paleta "rota" en el feature

**Fix obligatorio antes de portar**: borrar el `.js`/`.cjs`/`.mjs` y dejar solo el `.ts`. **Antes de borrar**, verifica que el `.ts` tenga:
- Todos los tokens base con `hsl()` wrapper: `background: "hsl(var(--background) / <alpha-value>)"`, NO `"var(--background)"`
- `primary`/`secondary`/`accent`/`destructive`/`popover`/`muted`/`card` como objetos `{ DEFAULT, foreground }` apuntando a CSS vars, NO hardcoded (`"hsl(221, 83%, 53%)"`)
- Tokens `input`, `ring`, `chart` (1-5), `sidebar` (DEFAULT + 7 sub-tokens), `surface-elevated` definidos
- `content` path incluye `./src/features/**/*` y `./src/shared/**/*`

Si el `.ts` está incompleto, ARRÉGLALO antes de borrar el `.js` (sino rompes pantallas que dependían del `.js`). Diff de referencia para arreglar un `.ts` incompleto: ver memoria `incident_tailwind_dual_config.md`.

### 7. Aplicar los 4 patches en orden

Los patches viven en `handoff_*/patches/`:

#### 7.1 `tailwind.config.ts` — REEMPLAZA el actual

```bash
cp handoff_*/patches/tailwind.config.ts frontend/tailwind.config.ts
```

**Antes de reemplazar**, haz `diff` con el actual para confirmar que **no pierdes tokens custom** del desktop (típicamente los `maity-pink`/`maity-blue`/`maity-green`/`maity-warning` ya están preservados, pero verifica).

#### 7.2 `globals.css.patch` — agrega CSS vars al `:root` y `.dark`

Lee el `.patch` y aplica las inserciones **manualmente con Edit tool** (no es un patch ejecutable, es texto descriptivo). Agrega vars dentro de cada `.dark`/`.dark.theme-X` block existente.

#### 7.3 `layout.tsx.patch` — opt-out de `/chat` (o ruta del feature) del Sidebar global

Lee el patch y aplica los 2 pasos:
1. Agrega `const isChatRoute = pathname === '/chat'` en `AppContent`
2. Envuelve el render final en `{isChatRoute ? <fullbleed> : <Sidebar + Main>}`

**Solo la ruta del feature** debe opt-out — TODAS las demás rutas conservan el Sidebar global del desktop.

#### 7.4 `<service>.ts.patch` — extensiones puntuales al service del desktop

Aplica los cambios al archivo del desktop manualmente. **NO copies el service de la web** — solo extiende el del desktop con las funciones/campos nuevos.

### 8. Cargar fuentes nuevas (si aplica)

Si el handoff requiere fuentes nuevas (Geist + Inter típicamente), agrégalas en `frontend/src/app/layout.tsx`:

```tsx
import { Inter } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-inter' })

// Geist no está en next/font/google — agregar @import en globals.css:
//   @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
```

Y en el `<body className={...}>` agrega `${inter.variable}` junto a la existente.

### 9. Aplicar migración SQL (opcional)

Si el handoff incluye `MIGRATION.sql`:
- **Verifica primero el nombre de la tabla** — los handoffs a veces tienen typos (`maity_chat_threads` vs `chat_threads` con schema `maity`). Confirma con `mcp__supabase__list_tables` antes de correr.
- Si la web ya aplicó la migración en el schema compartido, **no la apliques de nuevo** desde el desktop.

### 10. Verificar

```bash
cd frontend
pnpm tsc --noEmit | grep <feature>     # 0 errores en el feature (otros archivos pre-existentes son OK)
pnpm eslint src/features/<feature> src/shared/components/shell-vX --max-warnings 0
pnpm run tauri:build:debug              # exit 0 obligatorio (CLAUDE.md §2)
```

### 10.5. Validación post-build: arbitrary values en CSS (CRITICO)

Tras el build, verificar que las clases Tailwind arbitrary del feature efectivamente se purgaron al CSS final (no quedaron como dead code):

```bash
# Sustituye con clases representativas del feature copiado (típico chat/dashboard):
grep -c "max-width:760px\|font-size:22px\|border-radius:14px\|object-position:50%" frontend/.next/static/css/*.css
```

Debe encontrar **> 0 ocurrencias**. Si encuentra 0:
- Verifica que el `tailwind.config.ts` cubra el path del feature en `content`
- Verifica que NO haya un `tailwind.config.js` viejo competing (paso 6.5)
- Ejecuta `rm -rf .next && pnpm run tauri:build:debug` para forzar regeneración

**Regla meta**: si una clase arbitrary aparece en el JSX pero NO en el CSS purgado, está como **dead code**. El browser cae al default de la propiedad sin warning. Esto puede ocultar bugs visuales por meses (caso documentado: `object-[center_30%]` que silenciosamente caía a `50% 50%` por años).

Cuando un patch visual "no surte efecto" pese a estar bien escrito en el JSX, el primer check es el CSS purgado, no el código.

### 11. Limpiar

```bash
rm -rf _web_ref/
```

**Opcional**: deja `_web_ref/maity/` unos días por si necesitas re-copiar algo durante el desarrollo.

## Reglas estrictas

- **NO traduzcas código del web — copia tal cual.** Los adapters resuelven todos los imports.
- **NO modifiques los archivos copiados de la web** salvo el sed de `react-router-dom`.
- **NO instales `react-router-dom`** en el desktop. El shim `router-compat.ts` la reemplaza.
- **NO toques `Sidebar/index.tsx` del desktop.** Sigue siendo el rail global para todas las demás rutas.
- **Verifica el backend antes de modificarlo** — solo cambia lo del feature si el archivo correcto está identificado (busca el handler con grep).
- **NO reescribas tests.** Si un test copiado del web falla por algo del desktop, reporta en vez de "arreglarlo".
- **NO corras la migración SQL automáticamente** sin confirmar con el user.

## Cuando termines, reporta al user

1. Qué archivos copiaste de la web (lista de paths)
2. Si `pnpm tsc --noEmit` pasó (exit 0 o cuál fue el error)
3. Si `pnpm run tauri:build:debug` pasó (exit 0 + smoke test)
4. Si la migración SQL la aplicaste o sigue pendiente
5. Si el backend Python lo tocaste o no (y si sí, dónde)
6. Lo que ves al entrar a la ruta del feature por primera vez

## Patrones conocidos del repo desktop

- **Tabla Supabase**: `chat_threads` (sin prefijo `maity_chat_`), el client ya apunta al schema `maity` via RLS
- **Auth**: `useAuth().maityUser` (NO `useUser().userProfile`)
- **Logger**: `@/lib/logger` con `logger.debug/info` — NO `console.log/info` (ESLint `no-console`)
- **Build**: SIEMPRE `pnpm run tauri:build:debug` antes de reportar completado, NUNCA solo `cargo build`
- **Sidebar global**: vive en `src/components/Sidebar/index.tsx`, render condicional por `pathname`
- **Token semánticos chat**: `maity-pink`, `maity-blue`, `maity-green`, `maity-warning` (apuntan a CSS vars en `globals.css`)

## Cuándo abortar y pedir confirmación al user

- El `grep` de pre-borrado encuentra usos en otros features → reporta, no borres
- La migración SQL apunta a una tabla con nombre incorrecto → confirma con `list_tables` antes de aplicar
- El patch `layout.tsx` choca con cambios pre-existentes en `AppContent` → muestra el diff al user
- Hay conflicts en `tailwind.config.ts` (tokens custom del desktop que el patch eliminaría) → muestra el diff
- El service del feature en el desktop ya tiene las funciones que el patch dice "agregar" → pregunta si re-aplicar o saltar
