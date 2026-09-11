# Reglas de UI del desktop: gamificación, overlays, niveles de audio, guardado de archivos

> Extraído de CLAUDE.md (sep-2026) para adelgazar el contexto. **Leer la sección correspondiente ANTES de tocar el dashboard de gamificación, las ventanas flotantes, el guardado de archivos o los handlers de cierre de ventana** — cada bloque documenta regresiones reales y decisiones que NO deben revertirse.

## Los niveles de audio viven FUERA de React, y las ventanas flotantes no llevan blur (sep-2026, #07 de la auditoría)

`coach-float` y `recording-widget` guardaban `{micRms, sysRms}` en un `useState` de **la página completa**, alimentado por dos eventos de Tauri a 10 Hz cada uno (`recording-audio-levels` y `audio-levels`, hasta 20/s combinados, y `setLevels` creaba objeto nuevo siempre → re-render incluso en silencio absoluto). Cada tick reconciliaba ~70 nodos y 15 iconos SVG, y como las barras cuelgan de un `backdrop-filter: blur(22px)`, cada mutación de altura recomponía el blur **por CPU** en los equipos sin GPU dedicada (11 de 20 usuarios): ~36,000 renders/hora.
- **`lib/audioLevelsStore.ts`** es un store de módulo (singleton fuera de React, `subscribe`/`getSnapshot` de `useSyncExternalStore`) que adjunta los listeners al **primer** suscriptor y los suelta con el **último** (ref-count por `Set`). Filtra por epsilon (Δ < 1e-3 en ambos canales no notifica) y coalesce con rAF + tope de 4 Hz.
- **`getSnapshot()` DEBE devolver la misma referencia** mientras el valor no cambie: `useSyncExternalStore` compara con `Object.is` en cada render, así que devolver un objeto nuevo es el bucle infinito clásico de esa API. Y **el tercer argumento `getServerSnapshot` es obligatorio**: `next build` con `output:'export'` prerenderiza estas páginas `'use client'` igual y sin él tira "Missing getServerSnapshot".
- **`components/audio/AudioLevelBars.tsx`** es el único consumidor: componente hoja con `React.memo` que consume el store **directo**, así que un tick de audio ya no toca la página. Anima con **`transform: scaleY()`** y `transform-origin: bottom` sobre una barra de altura fija, no con `height` — `transform` es compositor-only; animar `height` con transiciones de 150 ms solapadas contra ticks de 100 ms hacía que el compositor no descansara nunca.
- **Import directo de `listen`, con excepción registrada.** El repo obliga a pasar por `createSubscriptionGroup` (issue #65, evita un doble-unlisten que revienta como `unhandledrejection`), pero ese helper asume un ciclo de vida 1:1 con un `useEffect`; aquí el ref-count sube y baja entre muchos componentes hoja de dos ventanas distintas. El store reimplementa la misma defensa localmente y está en la lista blanca de **`.eslintrc.json` Y de la fitness function `lib/tauriSubscribe.test.ts`** — las dos, o el test falla.
- **Fondo opaco `#0F1018` sin `backdropFilter`** en la barra y el drawer de coach-float y en recording-widget. Decisión de producto, no un descuido. El `clipPath` se conserva: las esquinas redondeadas siguen bien sobre fondo opaco en una ventana Tauri `transparent: true`.
- **`resetAudioLevels()`** existe porque las barras ya no se desmontan entre grabaciones (nunca se llega a 0 suscriptores), así que el reset automático del store no dispara al detener: sin ella el widget se quedaría mostrando el último nivel de la sesión anterior.
- **NO bajar `WATCHDOG_TICK_MS` (100 ms) en `recording_helpers.rs` para "arreglar" esto**: no es solo el intervalo de emisión, es el tick del watchdog de silencio de micrófono del mismo loop y `ticks_per_sec` deriva de él sus umbrales. El throttle va del lado del cliente. Tampoco sirve `emit_to` en vez de broadcast (verificado en tauri 2.11.2: no ahorra wakeups).
- Pendiente anotado: el `setInterval` de 2 s con doble `invoke` (`is_recording`/`is_recording_paused`) y el ticker de 1 s siguen en ambas páginas.

## Pantalla de grabación en lote: `BatchRecordingHero` (sep-2026)

Sin transcripción en vivo, la home quedaba vacía durante toda la grabación: una barra "Grabando • mm:ss", un punto azul y dos líneas de texto, y el resto del panel en blanco hasta la píldora. Los note-takers que tampoco muestran texto en vivo (Plaud, Granola, Voice Memos) enseñan siempre tres cosas: un visual que reacciona al sonido como prueba de captura, un temporizador y algo con significado. `app/(main)/_components/BatchRecordingHero.tsx` (montado por `TranscriptPanel` cuando `isRecording && transcriptionMode === 'batch'`) implementa la composición aprobada el 2026-09-11 (mockups: artifact "Pantalla de grabación", opciones 1 + 3): temporizador grande, barras por canal en espejo (mic arriba en `#485df4`, sistema abajo en `#10b981`), tarjeta **Ritmo** + anillo de **tiempo de palabra** (`components/coach/TalkTimeRing.tsx`), última recomendación del coach y una leyenda. Reglas:

- **Las barras son `AudioLevelBars`** (hoja memoizada sobre `audioLevelsStore`, #07): el hero NO conoce los niveles ni se re-renderiza por audio; nada de `useState` de niveles en la página ni animar `height`. Las props `origin` (`bottom|top`) y `gapPx` son aditivas. La envolvente (`buildEnvelope`) es determinista y se calcula una vez por módulo (test en `BatchRecordingHero.test.ts`).
- **"Ritmo", no "Salud"**: en lote el score sale de `coach/audio_heuristics.rs::health_score` (base 70; −10/−20 por monólogo >60/>120 s; −15 si hablas >80 %, +5 entre 40 y 60 %) y sólo puede valer entre 35 y 75. Etiquetarlo "Salud" prometía la rúbrica completa (preguntas, turnos, escucha) que sólo existe con texto. Reescalar el rango es decisión pendiente.
- **Minutos por canal** vienen de `MeetingMetrics.user_voiced_secs`/`interlocutor_voiced_secs` (aditivos, sólo en modo audio, `skip_serializing_if` en transcript); sin ellos el anillo cae a porcentajes.
- **Sin indicador de guardados/checkpoints** en esta pantalla: decisión de producto (2026-09-11), al usuario no le interesa.
- El último tip también lo muestra `LiveFeedbackPanel` arriba (stack de 3); si molesta el duplicado, decidir cuál de los dos lo pinta, no meter un tercer sitio.
- Las variantes descartadas (barras por persona, balanza con zona ideal, sólo números, onda con historial, animación ambiental, prueba de guardado) siguen en el artifact por si se retoman.

## Guardado de archivos generados (.md / .pdf / .pptx) — ago-2026

**Nunca usar `<a download>` en el desktop.** Dentro de WebView2 el destino lo decide el WebView: guarda en su propia carpeta de descargas sin preguntar, sin UI visible dentro de Tauri, y la app **nunca aprende la ruta** — por eso no podía confirmar el guardado ni ofrecer "abrir carpeta". Ese era exactamente el síntoma de los botones de descarga de Maity Chat ("parece que no hace nada, pero el archivo sí está en Descargas"). La ruta que "se recordaba" era del perfil de WebView2, no de la app.

El guardado lo hace Rust: `src-tauri/src/file_export.rs` → comando `save_artifact_file(defaultFileName, contentsBase64, filterName, extensions, forceAsk?)`, que devuelve `Some(ruta)` o **`None` si el usuario canceló** (no-op silencioso: el frontend no debe mostrar error). Frontend: helper único **`lib/saveArtifact.ts`** (blob → base64 con `FileReader`, toast con la ruta + acción "Abrir carpeta" que reusa `reveal_in_folder`). Vive en `lib/` y no dentro de una feature porque lo usan varias; sus strings están en el namespace **`export.*`** de `LanguageContext` (`export.save_success`, `export.save_reveal`, `export.filter_*`) — no bajo `chat.*`.

**Consumidores (todo botón de guardado nuevo debe pasar por aquí):** los tres de `features/maity-chat/components/ChatTurn.tsx` (.md / .pdf / .pptx) y el "Descargar PDF" de `features/conversations/components/minuta-v2/MinutaToolbar.tsx` (pestaña Minuta del detalle de conversación; migrado en ago-2026 — era el último `<a download>` vivo, con el síntoma clásico de "no avisa y no deja elegir carpeta"). El toast de éxito lo emite el helper, NO el caller: el caller solo hace `catch` → toast de error.

Reglas que no hay que romper:
- **El comando DEBE ser `async`.** `blocking_save_file()` despacha el diálogo al main thread y espera en un `sync_channel(0)`; desde un comando síncrono (que corre EN el main thread) **deadlockea la app**.
- **El diálogo se maneja desde Rust con `DialogExt`**, no desde JS. Así no hace falta instalar `@tauri-apps/plugin-dialog` ni agregar permisos `dialog:*` a las capabilities: los comandos propios no pasan por el ACL de Tauri. Mismo patrón que `database::commands::select_legacy_database_path`.
- **`@tauri-apps/plugin-fs` está instalado y sus permissions están en `tauri.conf.json`, pero el plugin NO se inicializa en `lib.rs`** → cualquier `writeFile` desde JS truena en runtime con "plugin fs not found". Las permissions obsoletas lo hacen parecer soportado; no lo está. Escribir con `std::fs` desde Rust.
- Extraer la ruta con `FilePath::into_path()`, **no** `.to_string()` (para la variante `Url` eso devuelve un `file://...`).
- Preferencia `ask_where_to_save` (default `true`) en `export_preferences.json` vía tauri-plugin-store, comandos `get/set_export_preferences`, toggle en Settings → General (`PreferenceSettings.tsx`, visible para todos los roles). En `false` escribe directo a Descargas desambiguando colisiones tipo Explorer (`doc (2).md`). **La verdad vive en Rust**, no en el frontend: la rama "no preguntar" resuelve la carpeta y las colisiones del lado nativo.

**PDF**: `features/maity-chat/utils/chat-document-pdf.tsx` para el documento del chat y `features/conversations/utils/minuta-pdf.tsx` para la minuta, ambos con `@react-pdf/renderer` en lazy-import (el bundle es pesado; se carga al primer click). Solo fuentes built-in del PDF (Helvetica/Courier) — sin `Font.register`, sin fetch de red, sin tocar la CSP. El markdown se parsea con `utils/markdownBlocks.ts` (hand-rolled y testeado): `remark-parse`/`unified` son deps transitivas privadas de `react-markdown` que pnpm no hoistea, y `==resaltado==` es extensión propia de Maity que remark no parsea igual.

**PPTX**: `PptxService.generateDeckBlob()` (en `shared/maity-shared.ts`) devuelve bytes. `generateDeck()` se conserva como la salida del navegador del web para minimizar drift — **no usarla en desktop**.

## Patron Visual: Dashboard de Gamificacion (DPI Scaling Windows)

El componente `GamifiedDashboardV2.tsx` y el Card de "Mision Actual" tienen reglas estrictas — violarlas ha causado 4 regresiones documentadas (commits `5400b67`, `2b90533`, `7ed9829` + iter 2 mayo 2026).

**Reglas (NO eliminar al refactorizar):**

1. **CERO breakpoints `md:`/`lg:` dentro del Card de la mision ni en el header del dashboard.** El DPI scaling de Windows (125%, 150%) hace que el viewport reportado al webview de Tauri caiga entre breakpoints de Tailwind, asi clases `md:flex-row` no se aplican y el layout colapsa a la version mobile (todo apilado vertical). Usar siempre flexbox de ancho fijo (`flex-1`, `w-1/2`, `w-[460px]`).

2. **Imagen como `<img>` con `object-cover object-center opacity-60 group-hover:opacity-70 transition-all`** — el `opacity-60` es CRITICO: atenua la imagen para que el cartel der con `bg-[#0F0F0F]` no contraste de manera abrupta. Sin el `opacity-60` la transicion se ve cortada (verificado mayo 2026, regresion del commit `829dd83` que quito el opacity al rediseñar al patron hibrido). El commit `2b90533` original ya tenia el `opacity-60` y funcionaba bien. Para `object-position`: `object-center` (50% 50%) ancla las cumbres de la imagen actual (`mission-mountain.jpg`, horizontal 1.5:1, cumbres en tercio medio). NO usar `object-[center_30%]` — empuja la vista hacia el cielo (probado mayo 2026). NO usar `bg-cover bg-bottom` (causo zoom/recorte feo en commit `5400b67`). Si la imagen cambia a una con composicion distinta, re-evaluar position y revisar si `opacity-60` sigue siendo necesario.

3. **Estructura HÍBRIDA: imagen full-width del Card + cartel der con `bg-[#0F0F0F]` propio.** Despues de iterar 4 veces (mayo 2026), el patron que funciona en desktop NO es ni full-width-puro (cartel se ve translucido sobre la imagen — iter 3) ni side-by-side-encerrado-puro (linea marcada vertical donde termina `w-1/2 overflow-hidden` — iter 4). Es un hibrido:
    ```tsx
    <Card className="relative overflow-hidden bg-[#0F0F0F]">
      {/* Imagen full-width del Card, NO encerrada */}
      <img className="absolute inset-0 w-full h-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-[#0F0F0F]" />

      <div className="relative flex min-h-[320px]">
        <div className="w-1/2 flex flex-col justify-end p-5">{/* texto Mision sobre la imagen, sin bg propio */}</div>
        <div className="w-1/2 bg-[#0F0F0F] p-5 ...">{/* cartel CON bg propio para tapar imagen detras */}</div>
      </div>
    </Card>
    ```
    **Por que funciona:** la imagen abarca todo el card sin borde fisico (no hay wrapper `overflow-hidden` cortandola). El cartel der tiene su propio `bg-[#0F0F0F]` que tapa la imagen visualmente desde el 50% del card. Como el gradient termina en `to-[#0F0F0F]` Y el cartel ES `bg-[#0F0F0F]`, ambos son el mismo color y la transicion es invisible.

4. **Gradient simetrico cinematografico** — `bg-gradient-to-r from-black/40 via-transparent to-[#0F0F0F]`. Inspirado del web (`to-card`). La SIMETRÍA visual `oscuro → claro → oscuro` da efecto cinematografico ademas de ayudar a ocultar la transicion. NO usar gradient asimetrico tipo `from-transparent ... to-[#0F0F0F]` sin `from-black/40` (causa "linea marcada" iter 2). NO usar stops arbitrarios `from-30% to-65%` (iter 2 fix-attempt) — la simetria tradicional `from-X via-transparent to-Y` es suficiente cuando el cartel der tiene bg propio. Si `bg-[#0F0F0F]` del Card padre cambia, este `to-[...]` Y el `bg-[...]` del cartel der deben coincidir exactamente.

5. **Layout outer del grid principal:** `<div className="flex gap-6 mb-6">` con `flex-1 min-w-0` (izquierda: misión + comunicación) y `w-[460px] shrink-0` (derecha: radar + ranking). El `min-w-0` evita que `flex-1` se desborde por contenido grande dentro.

**Imagen:** `frontend/public/images/mission-mountain.jpg` — bundleada localmente (eliminamos dependencia de Unsplash en `5400b67`).

**Si necesitas cambiar el split 50/50 dentro del Card,** modificar AMBOS lados con anchos consistentes (ej. `w-[55%]` + `w-[45%]`) sin breakpoints. Probar con DPI 125% y 150% en Windows antes de mergear.

**Botones "Empezar a grabar" / "Grabar otra" (estados vacíos del dashboard):** NO usar `router.push('/')` — el dashboard se renderiza EN la home (`app/(main)/page.tsx`), así que navegar a `/` es un no-op y el botón "no hace nada". Deben reutilizar el puente de grabación del Sidebar (`handleStartRecording` en `GamifiedDashboardV2.tsx`): si `pathname === '/'` → `window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'))` (escuchado en `useRecordingStart.ts`); si no → `sessionStorage.setItem('autoStartRecording','true')` + `router.push('/')` (consumido al montar la home). Es el MISMO mecanismo que el botón "Iniciar Grabación" del Sidebar (`SidebarProvider.tsx` → `handleRecordingToggle`).

## Overlay flotante de grabación (píldora inferior) — stacking vs. Sidebar

La píldora de grabación y el banner "no se detectó micrófono" (`app/(main)/page.tsx`) viven en un contenedor `fixed bottom-0 left-0 right-0` de ancho completo con gradiente decorativo `bg-gradient-to-t from-[#0a0a1a] ...`. Reglas para que NO tape el Sidebar:
- El contenedor externo va en **`z-30`** (por debajo del Sidebar `z-40`, que es opaco `bg-background`) → el Sidebar se pinta encima en su región y sus botones inferiores ("Configuración", "Acerca de", versión) quedan visibles y clicables. NO subirlo a `z-50` (regresión: la sombra tapa el menú lateral).
- El contenedor externo lleva **`pointer-events-none`** (el gradiente es decorativo) y el wrapper interior interactivo lleva **`pointer-events-auto`** → solo la píldora/banner reciben clics, el gradiente nunca bloquea al Sidebar ni al contenido del dashboard.
- La píldora interior se desplaza con `marginLeft` (`4rem`/`16rem` según `sidebarCollapsed`) para quedar en el área de contenido; sus dropdowns (`InlineDeviceSelector`, `z-[60]`) abren hacia arriba sin solaparse con el Sidebar.

## Header del Sidebar

- **Logo (`components/shared/Logo.tsx`):** rama no-colapsada muestra `/logo-collapsed.png` (28×28) + wordmark "Maity" con `text-foreground` (respeta la paleta del tema). NO usar la vieja píldora con `bg-[#f0f2fe]`/`dark:bg-blue-900/30` (fondo azul que no combina). Sigue siendo `DialogTrigger` → abre "Acerca de".
- **Búsqueda eliminada:** el input "Buscar contenido de reunión" fue removido de `Sidebar/index.tsx`. La infraestructura de búsqueda subyacente (`searchQuery`, `filteredSidebarItems`, `filteredConversations`, `searchResults`) permanece pero queda **inerte** (`searchQuery` siempre `''` → filtros devuelven la lista base). Si se reintroduce la búsqueda, volver a cablear un input a `setSearchQuery` + `searchTranscripts` (comando Tauri `api_search_transcripts`).

## La X de la ventana principal ESCONDE a la bandeja, y todo `onCloseRequested` de JS DEBE hacer `event.preventDefault()` (sep-2026)

El hide lo hace el handler de `CloseRequested` en `lib.rs`; salir del todo es solo "Salir" del tray. `@tauri-apps/api` llama `destroy()` por su cuenta cuando un handler JS no previene, y como la capability concede `core:window:allow-destroy` (`8bdd3bf`, ago-2026; lo exige `scripts/lint-tauri-acl.js`), ese `destroy()` funciona: el listener de telemetría `app.close` de `layout.tsx` destruía la ventana 40 ms después del hide y la app salía entera, **jornada activa incluida**. Así se embarcó en la 0.2.57 de la Store (18 `app.close` de 8 usuarios en 14 días, cada uno una muerte de la app). Antes del 08-17 el ACL rechazaba el `destroy()` en silencio, por eso nadie lo vio. `useWindowCloseGuard` no tiene call sites (código muerto) pero quedó corregido igual y con guard de re-entrada. `app.close` significa "el usuario cerró la ventana", no que el proceso terminó.

## Bundle de arranque de la main (sep-2026, #24 de la auditoría de recursos)

`out/index.html` es la primera pintura tras el login y el protocolo custom de Tauri sirve los chunks **sin gzip**, así que cada KB del arranque se paga entero. En sep-2026 el home cargaba 1,842 KB en 38 scripts: recharts (345 KB) para una gráfica que sólo aparece con 2+ conversaciones analizadas, framer-motion (111 KB) para un fade, tres familias de `next/font` que el home no usaba, y `/meeting-details` arrastraba BlockNote + tiptap + prosemirror (2.3 MB en su html + 1.26 MB de editor lazy) siendo una ruta sin un solo enlace entrante (`useRecordingStop` navega a `/conversations?localId=` desde hace meses).

| Métrica | Antes (09-sep, tras #23) | Después de #24 |
|---|---:|---:|
| `index.html` scripts / KB total / KB ejecutados | 38 / 1,842 / 1,733 | 32 / 1,379 / **1,269** |
| `@font-face` en el CSS de `index.html` | 60 | **0** (31 en `chat.html`) |
| `.woff2` en `out/_next/static/media` | 24 · 583 KB | 8 · 296 KB |
| `settings.html` | 35 scripts · 1,431 KB | 30 · 1,309 KB |
| `meeting-details.html` | 42 scripts · 2,315 KB | no existe |
| `out/` | 13 MB | 9 MB |

**Reglas (las vigila `frontend/scripts/lint-main-bundle.js` en el post-build; escape `MAITY_MAIN_BUNDLE_SKIP=1`, presupuesto `MAITY_MAIN_BUNDLE_BUDGET_KB`, default 1400 = medido + 10 %):**

1. **`framer-motion` SOLO bajo `features/auth/**`** (las transiciones entre pasos del registro con `AnimatePresence mode="wait"`; `/registration` ya es un chunk dinámico, así que framer sólo se descarga ahí, 120 KB, una vez por cuenta). Toda animación de entrada del resto de la app es un keyframe de `globals.css`: `animate-page-enter` (wrapper de la home), `animate-fade-in`, `animate-fade-in-down` (barra "Grabando • 00:00"), `animate-rise-in` (segmentos del transcript, tarjetas de modelo), `animate-scale-in` (✓ del modelo seleccionado). **Sin `forwards`** a propósito: un `transform` residual crea stacking context y tapa overlays `fixed` hermanos (la píldora de grabación vive fuera del wrapper animado por eso). Las transiciones de estado (subrayado de tabs de Ajustes, barra de progreso de descarga) van con `transition-[left,width]` / `transition-[width]` sobre `style` asignado por React (CSSOM, no lo bloquea la CSP del SSG). El botón "eliminar modelo" aparece con `group-hover:opacity-100` (+ `focus-visible`), no con estado React.
2. **`recharts` SOLO en `features/gamification/components/CommunicationTrendChart.tsx`**, que entra por `LazyCommunicationTrendChart` (`next/dynamic`, `ssr: false`, fallback `min-h-[240px] animate-pulse`). NO volver a importar recharts en `GamifiedDashboardV2.tsx` ni en nada que llegue al home. Molde para cualquier librería pesada nueva (gráficas, editores, 3D, PDF): `LazyVoxelAvatar`, `registration/page.tsx`, `billing/plans/page.tsx`.
3. **`next/font` SOLO en `app/(main)/chat/page.tsx`** (Geist para `font-geist`, Inter para `font-inter`; ambos tokens de `tailwind.config.ts` sólo los usan shell-v5 y maity-chat). El root layout `app/(main)/layout.tsx` no declara fuentes: `font-sans` es la pila del sistema. `Source Sans 3` se borró porque nadie la referenciaba. El wrapper de `/chat` es `display: contents` para no alterar el layout y sí heredar las custom properties.
4. **`/meeting-details` no existe** y con ella se fueron `components/MeetingDetails`, `hooks/meeting-details`, `components/AISummary`, `components/BlockNoteEditor`, `usePaginatedTranscripts`, `EmptyStateSummary`, `BluetoothPlaybackWarning` y los tipos V1 (`types/api`, `blocknote`, `communication`). Los comandos Rust que quedaron sin call site (`api_process_transcript`, `api_cancel_summary`, `api_list_templates`, `api_save_meeting_summary`, `open_meeting_folder`, `api_get_meeting_transcripts`) siguen registrados por la decisión "documentar, no borrar" de `docs/COACH_LLM_ARCHITECTURE.md`.

**Cómo medir a mano** (desde `frontend/out/` tras `pnpm build`): `node scripts/lint-main-bundle.js` da scripts, KB totales/ejecutados y `@font-face`; para saber qué html carga un chunk: `grep -l "<nombre del chunk>" *.html` (un chunk que ningún html referencia es lazy/dynamic). Marcadores por librería en el JS minificado: framer `framerAppearId`, recharts `recharts-wrapper`, editor `ProseMirror`, three `WebGLRenderer`, pptx `PptxGenJS`.

**Correcciones al hallazgo original:** no hay `@mantine` (BlockNote 0.36 iba por `@blocknote/shadcn`); las fuentes NO se descargaban en el home (sin `<link rel=preload>`, `font-display: swap`: sólo se bajan cuando un texto las usa), así que su costo de arranque real era el CSS de `@font-face` y el disco del instalador; y `next.config.js` no necesita `optimizePackageImports` (lucide-react ya está en la lista por defecto de Next 14 y recharts sale por `dynamic()`). **Fuera de este ciclo, anotado:** `tailwindcss-animate` está instalado pero NO registrado en `tailwind.config.ts` — todos los `animate-in fade-in …` de los primitivos shadcn y del dashboard son no-op hoy; activarlo cambia el look de diálogos/selects en toda la app y merece su propio ciclo. `features/conversations/components/minuta/` + `charts/` (GaugeChart con recharts) están muertos (cero importadores; no entran al bundle). `reactStrictMode: false` conserva un comentario que ya no aplica.
