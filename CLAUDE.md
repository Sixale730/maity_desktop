# CLAUDE.md

Este archivo proporciona orientacion a Claude Code al trabajar con este repositorio.

## Descripcion del Proyecto

**Maity Desktop** es un asistente de reuniones con IA enfocado en privacidad que captura, transcribe y resume reuniones localmente. Dos componentes principales:

1. **Frontend**: App de escritorio Tauri (Rust + Next.js + TypeScript)
2. **Backend**: Servidor FastAPI para persistencia y resumenes LLM (Python)

### Stack Tecnologico
- **App de Escritorio**: Tauri 2.x (Rust) + Next.js 14 + React 18
- **Procesamiento de Audio**: Rust (cpal, whisper-rs, ONNX Runtime, mezcla de audio profesional)
- **Transcripcion**: Whisper.cpp (local, GPU) + Parakeet (local, ONNX) + Moonshine (local, ultra-rapido) + Deepgram (nube, proxy)
- **Backend API**: FastAPI + SQLite (aiosqlite) — modulo DB en `backend/app/db/`
- **Integracion LLM**: Ollama (local), Claude, Groq, OpenRouter, Custom OpenAI
- **Cloud**: Supabase (schema `maity`) + Vercel API + Cloudflare Workers
- **Auth**: Google OAuth -> Supabase Auth

## Índice de docs de reglas (LEER ANTES de tocar el área)

Los post-mortems y reglas detalladas viven en `docs/`. **Antes de modificar código de un área, lee su doc** — cada uno documenta bugs reales de producción y decisiones marcadas "no revertir":

| Área | Doc |
|---|---|
| Canales Store/MSIX vs NSIS, migraciones, updater, VC++ runtime | `docs/CANALES_DISTRIBUCION.md` |
| Audio, VAD, checkpoints, retención, dispositivos, grabación, meeting detector | `docs/REGLAS_AUDIO_GRABACION.md` |
| Gates de sesión/registro, onboarding, scheduler de jornada, descargas de modelos | `docs/ONBOARDING_Y_GATES.md` |
| Cliente Supabase, roles, sync queue, lista de conversaciones, análisis V4, email, pagos | `docs/NUBE_CUENTAS_SYNC.md` |
| UI: gamificación DPI, overlays, niveles de audio, guardado de archivos, cierre de ventana | `docs/UI_REGLAS.md` |
| Notificaciones nativas (toasts) | `docs/NOTIFICACIONES_NATIVAS.md` |
| Ciclo de vida del motor STT (carga/descarga por sesión) | `docs/TRANSCRIPTION_PIPELINE.md` |
| Coach, sidecar Gemma, tips LLM | `docs/COACH_LLM_ARCHITECTURE.md` |
| ONNX execution providers / GPU en motores ONNX | `docs/ONNX_EXECUTION_PROVIDERS.md` |
| ffmpeg bundleado, GC del target/, política de deps Rust | `docs/BUILDING.md` |
| Telemetría (catálogo, heartbeats, mem_sampler, bundle de incidente) | `docs/TELEMETRIA.md` |
| Auditoría de recursos sep-2026 (hallazgos #NN) | `docs/AUDITORIA_RECURSOS_2026-09-02.md` |
| Plan de migración a transcripción por lote (fases F0-F6 + estado) | `docs/PLAN_MIGRACION_LOTE.md` |

## Skills (Slash Commands)

- **`/build [patch|minor|major]`** — Build firmado de produccion con bump de version en 4 archivos (`tauri.conf.json`, `package.json`, `Cargo.toml`, `Package.appxmanifest` en formato MSIX `X.Y.Z.0`). Definicion: `.claude/skills/build/SKILL.md`
- **`/store-msix`** — Empaqueta y publica en la Microsoft Store (pipeline independiente del build normal; sin Certum, sin updater de Tauri). Definicion: `.claude/skills/store-msix/SKILL.md`
- **`/store-listing`** — Ficha de la Store (Partner Center): abre los assets de `store_listing_assets/` y los textos copiables. Definicion: `.claude/skills/store-listing/SKILL.md`
- **`/piloto-analisis [empresa|company_id] [desde] [hasta]`** — Analiza un piloto empresarial desde Supabase: entregable A (notas técnicas internas) + B (artifact HTML para el manager del cliente, conductas sin jerga ni KPIs de volumen). Definicion: `.claude/skills/piloto-analisis/SKILL.md`

**Reglas de canales (detalle en `docs/CANALES_DISTRIBUCION.md`):**
- **Las migraciones de DB deben ser ADITIVAS** (version-skew dentro de cada canal; la Store va días atrás por certificación). Un `DROP`/`RENAME` rompe versiones viejas y el build compila verde igual.
- **Todo `.dll` nuevo del que dependa un binario debe viajar dentro del paquete** (vcredist app-local vía `stage-vcredist.js`; excepción: `api-ms-win-crt-*.dll`, UCRT).
- Store y descarga directa **NO comparten DB ni modelos** (el MSIX instalado redirige AppData). La doble instalación se mitiga con `rival_install.rs` (diálogo forzado; orquestador `.cmd` con `CREATE_BREAKAWAY_FROM_JOB`, **nunca** `DETACHED_PROCESS`).
- **Nunca usar el `latest.json` de GitHub como referencia del canal Store**; el aviso de actualización bajo MSIX compara contra `maity.system_config['desktop_store_latest_version']`.

## Comandos Esenciales de Desarrollo

### Frontend (App de Escritorio Tauri) — Ubicacion: `/frontend`

```bash
# Desarrollo en macOS
./clean_run.sh              # Build limpio y ejecutar con logging info
./clean_run.sh debug        # Ejecutar con logging debug

# Desarrollo en Windows
clean_run_windows.bat       # Build limpio y ejecutar

# Comandos Manuales
pnpm install                # Instalar dependencias
pnpm run dev                # Servidor dev Next.js (puerto 3118)
pnpm run tauri:dev          # Modo desarrollo completo Tauri
pnpm run tauri:build        # Build de produccion (release)
pnpm run tauri:build:debug  # Build debug (mas rapido, para verificar)

# Builds especificos por GPU
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # Solo CPU (sin GPU)
```

### Backend (Servidor FastAPI) — Ubicacion: `/backend`

```bash
./build_whisper.sh small              # macOS: compilar Whisper con modelo 'small'
./clean_start_backend.sh              # macOS: iniciar servidor FastAPI (puerto 5167)
build_whisper.cmd small               # Windows
clean_start_backend.cmd               # Windows
./run-docker.sh start --interactive   # Docker macOS/Linux | .\run-docker.ps1 start -Interactive (Windows)
```

**Modelos Whisper**: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` (variantes `.en` disponibles)

### Endpoints
- **API Backend**: http://localhost:5167 (opcional; docs en `/docs`) — **Frontend Dev**: http://localhost:3118

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Frontend (App de Escritorio Tauri)                     │
│  UI Next.js (React/TS, 9 contextos) <> Backend Rust (Audio+IPC,          │
│  16 modulos) <> Motores STT (Whisper/Parakeet/Moonshine/Canary/Deepgram) │
│  + Sync Queue (offline-first) + SQLite (7 repos) + Notificaciones        │
│  + Meeting Detector (apagado) + Logging rotativo                         │
└─────────┬───────────────────────────────────────────────────────────────┘
          │ HTTP/WebSocket (opcional)
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│   Backend (FastAPI + SQLite)     │     Cloud (Supabase + Vercel API)    │
│   Persistencia local + LLM       │     Auth, sync, analysis, proxy      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Modulos Rust (16 modulos en `src-tauri/src/`)

| Modulo | Descripcion |
|--------|-------------|
| `audio/` | Pipeline de audio completo (~45 archivos): captura, VAD, mezcla, grabacion, transcripcion |
| `whisper_engine/` | Motor Whisper.cpp con GPU (el "procesamiento paralelo" se borró en sep-2026, #21: nadie lo invocaba) |
| `parakeet_engine/` | Motor Parakeet ONNX (~150MB, rapido on-device) |
| `moonshine_engine/` | Motor Moonshine ONNX (ultra-rapido, dual decoder) |
| `canary_engine/` | Motor NVIDIA NeMo Canary (mejor espanol; comandos `canary_*` en `lib.rs`, opción solo admin) |
| `summary/` | Resumenes: LLM client multi-provider, templates, communication evaluator, `summary_engine/` (sidecar) |
| `database/` | SQLite: `manager.rs`, `setup.rs` (migraciones), `maintenance.rs`, 7 repositorios en `repositories/` |
| `api/` | Cliente HTTP + finalizacion cloud (`finalize.rs`, `retry_analysis.rs`) |
| `meeting_detector/` | APAGADO por kill-switch; su `ProcessMonitor` lo reusa `scheduled_recording` |
| `notifications/` | Notificaciones con DND, consent y transporte nativo propio (`toast.rs`) |
| `logging/` | Logger rotativo, `mem_sampler.rs`, telemetria (`telemetry/catalog.rs`), `incident.rs` |
| `analytics/` | Event tracking (PostHog) |
| `ollama/`, `openrouter/` | Clientes LLM |
| `auth_server.rs` | Servidor OAuth localhost para Supabase auth |
| `state.rs`, `tray.rs`, `onboarding.rs`, `utils.rs` | Estado global, tray, onboarding, utilidades |

### Pipeline de Procesamiento de Audio (Comprension Critica)

El sistema de audio tiene **tres rutas paralelas**:

```
Audio Crudo (Microfono + Sistema)
         ↓
    AudioPipelineManager (pipeline.rs)
    ┌────────┬──────────────┬──────────────────┐
    ↓        ↓              ↓                  ↓
Grabacion   Transcripcion  Transcripcion Nube
Stereo L/R  VAD local      Deepgram WebSocket
    ↓        ↓              ↓
RecordingSaver WhisperEngine DeepgramProvider
```

**Puntos Clave**:
- **Grabacion stereo**: Audio entrelazado (L=microfono/usuario, R=sistema/interlocutor) para separacion de hablantes
- **VAD dual-canal**: Procesadores VAD independientes para microfono (`mic_vad_processor`) y sistema (`sys_vad_processor`)
- **Atribucion de hablante**: `DeviceType` (Microphone/System) se captura ANTES de enviar al motor de transcripcion, mapeando `Microphone->"user"` y `System->"interlocutor"`
- **Ring Buffer de mezcla**: Acumula muestras hasta ventanas alineadas de 50ms; ducking RMS evita que audio del sistema ahogue al microfono

**Guía de ubicación en `audio/`** (el árbol completo se descubre con Glob/graphify):
- Deteccion de dispositivos -> `devices/discovery.rs` o `devices/platform/{windows,macos,linux}.rs`
- Captura -> `capture/microphone.rs` o `capture/system.rs` (WASAPI loopback: `capture/wasapi_loopback.rs`)
- Mezcla/procesamiento/VAD -> `pipeline.rs` + `vad.rs` (crate Silero vendorizado en `vendor/silero-rs/`)
- Flujo de grabacion -> `recording_manager.rs` + `recording_lifecycle.rs` + `recording_state.rs` + `recording_helpers.rs`
- Guardado -> `recording_saver.rs` + `incremental_saver.rs` (checkpoints 30s); retención -> `audio_retention.rs`
- Transcripcion local -> `transcription/engine.rs` + `transcription/worker.rs`; nube -> `transcription/deepgram_provider.rs`
- Hot-swap/monitoreo de dispositivos -> `device_monitor.rs`; Bluetooth -> `bluetooth_guard.rs`
- Codificacion -> `encode.rs` + `ffmpeg.rs` + `ffmpeg_mixer.rs`

> **Reglas obligatorias del área** (detalle y porqués en `docs/REGLAS_AUDIO_GRABACION.md`): el crate Silero está **vendorizado con parches** — no actualizarlo ni mover su `.onnx` a `models/` (#01); el medidor EBU R128 usa `Mode::HISTOGRAM` — no "arreglarlo" con `set_max_history` (#11); checkpoints con buffer contiguo + semáforo de 1 encode — no cambiar el intervalo de 30 s ni la extensión `.mp4` (#08/#18); bitrate de encode **64k congelado en tests** y barrido de retención condicionado a `finalize_conversation` completado (#27); `device_monitor` usa `snapshot_device_names` — **no volver a `list_audio_devices()` en un loop** (#17); la detección Bluetooth es **nativa por property store, nunca por nombre**; el level monitor usa registro de owners con tombstones, no refcount; watchdog de silencio de mic con latch en la task de 100 ms.

### Motores de Transcripcion (4 locales + 1 nube)

| Motor | Tipo | Archivos | Caracteristicas |
|-------|------|----------|-----------------|
| **Whisper** | Local, GPU | `whisper_engine/` | Metal/CUDA/Vulkan, modelos tiny→large-v3 |
| **Parakeet** | Local, ONNX | `parakeet_engine/` | ~150MB, rapido on-device, auto-download |
| **Moonshine** | Local, ONNX | `moonshine_engine/` | Ultra-rapido, dual decoder |
| **Canary** | Local, ONNX | `canary_engine/` | NVIDIA NeMo, mejor espanol (2.69% WER); opción solo admins |
| **Deepgram** | Nube, WS | `transcription/deepgram_*.rs` | Via Cloudflare Worker proxy, Nova-3 |

- **GPU en los motores ONNX: CPU por defecto, DirectML opt-in (`--features onnx-directml`), DirectX en delay-load (#33).** Leer `docs/ONNX_EXECUTION_PROVIDERS.md` ANTES de "optimizar un modelo con GPU"; no quitar el `/DELAYLOAD` de `build.rs` "porque el feature ya está apagado" — son capas independientes. Guard: `frontend/scripts/lint-exe-imports.js`.
- **El motor STT se carga sólo con sesión + registro (`ensure_stt_warm`) y se descarga en logout y en reposo tier Low (#02).** NO devolver la precarga al `setup()` de `lib.rs`. Detalle (STT_WARM_LOCK, PRELOADED_ENGINE, reciclado, idle_unload): `docs/TRANSCRIPTION_PIPELINE.md` § Ciclo de vida del motor STT.

### Base de Datos Local y Sync Queue (Offline-First)

`database/` tiene 7 repositorios (`meeting`, `transcript`, `transcript_chunk`, `summary`, `setting`, `recording_log`, `sync_queue`). La sync queue genera jobs por grabacion (meeting, transcripts, summary, finalize) con dependencias; comandos `sync_queue_*` registrados en `lib.rs`.

> **La cola se PODA vaciando `payload` (`trim_completed_payloads`), JAMÁS borrando filas completadas (#26).** Un `DELETE` rompe el barrido de audio (#27), el `sync_state` de la lista y los finalize diferidos por cuota — por eso `cleanup_old_completed` se BORRÓ. Detalle: `docs/NUBE_CUENTAS_SYNC.md`.

### Comunicacion Rust <-> Frontend

Comandos via `invoke()` (Frontend->Rust), Eventos via `emit()`/`listen()` (Rust->Frontend). Todos los comandos registrados en `lib.rs`. Grupos principales: grabacion (`start/stop/pause/resume_recording`, `get_recording_state`), dispositivos (`list_audio_devices`, `switch_audio_device` — la auto-reconexión lo reusa desde el evento `DeviceReconnected`), transcripcion/checkpoints, Deepgram proxy, sync queue, meeting detector, notificaciones, logging, OAuth, sistema audio. Los comandos del "Whisper paralelo" se ELIMINARON en sep-2026 (#21, código muerto; recuperable de git).

**Patron de estado**: Comandos Tauri actualizan estado Rust -> Emiten eventos -> Listeners del frontend actualizan estado React -> El contexto se propaga a los componentes.

> **Notificaciones nativas: transporte propio, NUNCA `@tauri-apps/plugin-notification` ni `app.notification().builder()`** (funcionan en NSIS y fallan MUDOS bajo MSIX/Store). Toda notificación nueva pasa por `sendNativeNotification` (TS) / `show_native_toast` (Rust, `notifications/toast.rs`). No invertir el orden de ramas de `resolve_target`. Detalle: `docs/NOTIFICACIONES_NATIVAS.md`.

### Gestion de Modelos

Ubicaciones: dev `frontend/models/`; produccion `~/Library/Application Support/com.maity.ai/models/` (macOS) / `%APPDATA%\com.maity.ai\models\` (Windows; bajo MSIX el AppData va redirigido — ver `docs/CANALES_DISTRIBUCION.md`). Los modelos se cachean al cargar; auto-deteccion de GPU con fallback a CPU.

## Arquitectura Frontend

### Paginas (Routes)

| Ruta | Descripcion |
|------|-------------|
| `/` | Interfaz principal de grabacion (el dashboard gamificado se renderiza AQUÍ, `app/(main)/page.tsx`) |
| `/conversations` | Lista de conversaciones (local-first); detalle con `?id=` (cloud) o `?localId=` (SQLite) |
| `/gamification` | Dashboard gamificado (volcan de progreso) |
| `/notes`, `/tasks` | Notas y tareas extraidas de conversaciones |
| `/settings` | Configuracion de la app |
| `/registration` | Onboarding de registro (17 pasos) — solo `registration_form_completed=false` |
| `/billing/plans` | Seleccion de plan; checkout Pro via handoff a navegador externo |
| `/coach-float`, `/recording-widget`, `/device-picker` | Ventanas auxiliares — route group `app/(aux)/` con root layout propio (#23) |

> **Route groups (sep-2026, #23 de la auditoría):** las páginas de la main viven en `app/(main)/` (con el `RootLayout` de providers) y las ventanas aux en `app/(aux)/` con un root layout mínimo (`(aux)/layout.tsx`: server component, solo html/body + `globals.css`). NO existe `app/layout.tsx` de nivel superior — volvería a envolver a TODAS las rutas y Next empaquetaría el grafo de la main para cada ventana aux (era el hallazgo: 1.17 MB de JS por ventana, de los que la página eran 27 KB; el early-return en runtime evitaba MONTAR, no CARGAR). Las URLs no cambian; los chunks se llaman `chunks/app/(main)/…` y `chunks/app/(aux)/…`. Guardas: `app/(aux)/layout.test.ts` (sin `app/layout.tsx`, sin layouts anidados bajo `(aux)`, biyección `AUX_WINDOW_PATHS` ↔ `(aux)/<label>/page.tsx`, y el grafo de imports aux NO alcanza `lib/supabase.ts`/`platformLogger`/`analytics`/`contexts/`/`(main)` ni sonner/TanStack/Radix/`next/font`) y `scripts/lint-aux-bundle.js` en el post-build (mide `out/<aux>.html`: sin chunks de `(main)`, sin sonner/supabase, ≤450 KB ejecutados). Rutas con paréntesis: entrecomillar en Git Bash; en PowerShell `(main)` es una subexpresión.

### Gates, sesión y onboarding — reglas vigentes (detalle en `docs/ONBOARDING_Y_GATES.md`)

- **Sin sesión la app NO graba por ninguna vía**: la verdad vive en Rust (`state.rs::has_session`); el gate está en los entrypoints nativos (tray/scheduler), NO en los comandos invocables del frontend (crearía carrera con `set_current_user`). El login compacto 480×640 lo maneja `set_main_window_auth_layout`; el logout llama `logout_cleanup` ANTES de limpiar estado (guarda la grabación activa).
- **Gate de registro fail-closed en Rust (#66)**: `registration_completed(app)` con `None` → `false`, en el mismo embudo (`initialize_recording`, scheduler, tray). El frontend usa `!== true`, nunca `=== false`. No "simplificar" quitando el gate del embudo "porque el layout ya lo tiene": ese fue el bug (21 jornadas grabadas sin registro).
- **Back-off del arranque de jornada**: clasificación por HRESULT (`classify_device_error`, nunca substring), política por causa, alto del día para `NoInputDevice`. `check_microphone_ready` va SOLO por acción del usuario — nunca en `usePermissionCheck` ni en un intervalo.
- **El estado del onboarding es MONÓTONO y leerlo NO escribe**: `reconcile_status` solo avanza; retroceder es acción explícita del usuario. Acepta cualquier modelo del registry.
- **Descargas de modelos**: arranque en UN solo lugar (`WelcomeStep` / `BackgroundDownloadStarter`), promesas de kickoff reusadas — no relanzar una descarga viva (dos writers sobre el mismo `.onnx` corrompen en silencio). `ModelDownloadGate` bloquea SOLO por Parakeet, va DESPUÉS del registro, es PASIVO y sin botón de omitir. En tier Low NO se descarga Gemma; los consumidores miran `summaryModelReady`, NO `summaryModelDownloaded`.
- El iframe de YouTube del registro exige `frame-src`/`child-src` con `https://www.youtube.com` en la CSP (en `pnpm dev` no se nota; en el empaquetado sí).

### Coach y sidecar Gemma — reglas vigentes (detalle en `docs/COACH_LLM_ARCHITECTURE.md` § Apéndice)

- **El único consumidor vivo del `llama-helper` son los tips en vivo del coach.** Maity Chat y el análisis V4 son NUBE; `coach_chat`/`coach_evaluate_meeting` son código muerto. **No asumir que algo "usa Gemma" sin buscar su call site en TS.**
- **En tier Low el LLM del coach está APAGADO**: `coach::should_use_llm_tips()` es el punto de decisión único (lo consultan el warmup y `live_feedback::start`; si divergieran, quedaría un modelo residente sin consumidor).
- **El sidecar no muere por idle durante una grabación (#03)**: lease RAII (`SidecarManager::keepalive()`); el breaker del coach es un tipo con política pura. No tocar los timeouts de 300 s.
- **Provenance del sidecar**: `verify-helper-binary.js` en el pre-build falla si el SHA-256 del binario bundleado no coincide; regenerar con `--fix`. Un stub de 0 bytes en `binaries/` hace fallar el spawn.

### Cuentas, nube y análisis — reglas vigentes (detalle en `docs/NUBE_CUENTAS_SYNC.md`)

- **Cliente Supabase con default `public`**; las tablas de `maity` van SIEMPRE con `.schema('maity')` explícito; los RPC entran por wrappers `public.*`. Guardias: regla ESLint `no-restricted-syntax` (`.rpc()` pelón) + `lib/supabase.test.ts`. `src/shared/maity-shared/**` está exento. Realtime hardcodea `schema: 'maity'` — correcto, no tocar.
- **Roles (`admin|manager|user`) SIEMPRE desde la DB (RPC `public.get_user_role`), fail-closed**: `null` = desconocido, jamás "es user"; NO reintroducir heurísticos por dominio de email (`ADMIN_DOMAINS` se eliminó y hay test). El Sidebar NO filtra por rol.
- **Verificación de email**: NO cambiar `emailRedirectTo` a localhost/deep-link; el flujo PKCE `?code=` solo es canjeable en el webview que lo inició.
- **CTA "Ver planes" → ruta interna `/billing/plans`, NO `PRICING_URL`** (la landing expulsa a usuarios con sesión).
- **Retry de análisis en `quota_skipped`**: comando `retry_analysis_cloud`, NUNCA `reanalyzeConversation` (re-despacharía la minuta y no pasa por `decideRetryPlan`). El 403 de cuota se detecta por el campo `error` con el helper `parse_quota_403`.
- **Lista de conversaciones PROYECTADA (#05)**: `LIST_COLUMNS` explícito, nunca `select('*')` (hay test); `getCommScore`/`derivePhase` ramifican por `_projection` ANTES de mirar los JSONB (sin eso una fila legacy dispara re-análisis y **quema cuota**); gamificación tiene su propia queryKey (`['omi-conversations-analysis', userId]`).
- **Análisis V4 rúbrica 6.x (#72-#74)**: "tiene análisis" = `isFullAnalysis(v4)`, nunca truthiness (el marcador skipped es truthy); puntajes agregados vía `utils/scoring.ts::getCommScore`; un componente `null`/`no_aplica` NUNCA se pinta como 0.

### Context Providers (en `layout.tsx`)

`ThemeProvider` → `QueryClientProvider` (React Query, 5 min stale) → `AuthProvider` → `OnboardingProvider` → `ConfigProvider` → `RecordingPostProcessingProvider` → `TranscriptProvider` → `OllamaDownloadProvider` → `ParakeetAutoDownloadProvider` + `RecordingStateProvider`, `AnalyticsProvider`, `UpdateCheckProvider`. Componentes globales: `SplashScreen`, `AuthGate`, `ChunkErrorRecovery`, `ErrorBoundary`, `OfflineIndicator`, `CloudSyncInitializer`, `HealthHeartbeatInitializer`, `GlobalConversationNotifier`, `DbInitErrorGate`, etc.

> **Ventanas auxiliares** (`/coach-float`, `/recording-widget`, `/device-picker`): viven en `app/(aux)/` con su propio root layout (ver § Paginas), así que el `RootLayout` de `(main)` ya no las envuelve ni en bundling ni en runtime; su early-return `isAuxWindowPath` queda como defensa en profundidad. Lista canónica en `lib/auxWindows.ts` (`isAuxWindowPath`) — no duplicarla inline. Los initializers llevan además su propio gate `isAux` (el efecto depende del booleano, NO de `pathname`). **Nada de supabase/platformLogger/sonner/contexts en una ventana aux**: telemetría de producto → `lib/auxAnalytics.ts::trackAux` (comando `log_analytics_event` → outbox nativo, `ctx.emitter='webview'` + `window` real); feedback → `save_user_feedback` (Rust guarda y sincroniza la RPC `insert_user_feedback`, único escritor desde #23; `SessionFeedbackModal` tampoco la llama ya). `open_floating_coach` y `open_device_picker` muestran la ventana al recibir `on_page_load(Finished)` (helper `first_page_load`/`wait_first_page_load` en `coach/commands.rs`, timeout 2 s), no tras un `sleep`.

> **Los niveles de audio viven FUERA de React (#07)**: store `lib/audioLevelsStore.ts` (`useSyncExternalStore`; `getSnapshot` con misma referencia, `getServerSnapshot` obligatorio) + `AudioLevelBars.tsx` animando con `transform: scaleY()`. Las ventanas flotantes van con fondo opaco sin `backdropFilter` (decisión de producto). NO bajar `WATCHDOG_TICK_MS` (100 ms). Detalle: `docs/UI_REGLAS.md`.

Hooks (23) en `hooks/`, servicios en `services/`, utilidades en `lib/`, features en `features/` (conversations, gamification, notes, tasks, maity-chat, auth) — se descubren con Glob; los nombres son descriptivos (`useRecordingStart`, `conversations.service.ts`, `analysisPollingService.ts`, `lib/roles.ts`, …).

### Guardado de archivos generados (.md / .pdf / .pptx)

**Nunca `<a download>` en el desktop** (WebView2 guarda sin preguntar y la app nunca aprende la ruta). Todo guardado pasa por el comando `save_artifact_file` (Rust, `file_export.rs`; DEBE ser **async** — síncrono deadlockea) vía el helper único `lib/saveArtifact.ts`. El diálogo se maneja desde Rust con `DialogExt`; `@tauri-apps/plugin-fs` NO está inicializado aunque sus permissions existan. Detalle y consumidores: `docs/UI_REGLAS.md`.

## Patrones Criticos de Desarrollo

### Seguridad de Hilos y Estado Compartido
- `Arc<RwLock<T>>` para estado compartido entre tareas async, `Arc<AtomicBool>` para flags simples
- Mutex con `.lock().map_err()`, **nunca** `.lock().unwrap()` — evita panics por envenenamiento de mutex
- Ver `recording_state.rs` para el patron de referencia

### Logging Consciente del Rendimiento
- `perf_debug!()`/`perf_trace!()` para logging en rutas criticas — costo cero en builds de release (definidos en `lib.rs`)
- `AudioBufferPool` (buffer_pool.rs) para pre-asignar buffers (el `AudioMetricsBatcher` se borró en sep-2026, #10)

### Rendimiento de Audio
- El filtrado VAD reduce la carga de Whisper en ~70% (solo procesa voz); guardado incremental con checkpoints de 30s
- EBU R128 loudness via `ebur128` (**`Mode::HISTOGRAM` obligatorio**, #11) y noise suppression via `nnnoiseless` — reglas en `docs/REGLAS_AUDIO_GRABACION.md`
- Features de Cargo para GPU: `--features cuda`, `--features vulkan`, `--features metal`

## Flujo Local-First de Grabacion

```
Usuario detiene grabacion
    ↓
flush buffer (500ms) → Guardar en SQLite local
    ↓
Navegar a /conversations?localId=XXX&source=recording (instantaneo)
    ↓
Fire-and-forget: sync cloud via sync_queue (background)
    ↓
ConversationDetail: muestra datos locales, poll cloud analysis
```

Reglas asociadas (detalle en `docs/REGLAS_AUDIO_GRABACION.md`):
- **Recuperación de grabaciones interrumpidas**: automática (`autoRecoverAll`) con filtro de fantasmas (`transcriptCount === 0` se borra de IndexedDB sin tocar disco); el diálogo `TranscriptRecovery` es solo red de seguridad.
- **`finalize_segment_native` devuelve `SegmentOutcome::{Saved,Discarded,Failed}`, NO `Option`** (#4 del piloto) — un descarte señalizado como `None` revivía el segmento por dos caminos. Umbral: `MIN_SEGMENT_WORDS` = 250, contando AMBOS canales, sin corte por densidad.
- **`started_at` se SELLA (`recording_start_wall`), nunca se deriva como `ahora − duración`** (#5 del piloto: con suspend, `Instant::elapsed()` sigue corriendo). `should_rotate` con wall-clock es correcto; `MAX_SEGMENT_MINUTES` = 90 **rota, no cierra** en overtime; las grabaciones manuales no rotan.

## UI: reglas de patrones visuales

Detalle completo en `docs/UI_REGLAS.md` — resumen de lo que NO hay que romper:
- **Dashboard de gamificación (`GamifiedDashboardV2.tsx`)**: CERO breakpoints `md:`/`lg:` en el Card de misión (el DPI scaling de Windows los rompe); estructura híbrida imagen full-width + cartel con `bg-[#0F0F0F]` propio; el `opacity-60` de la imagen es crítico. 4 regresiones documentadas.
- **Botones "Empezar a grabar" del dashboard**: NO `router.push('/')` (el dashboard YA está en `/`); usar el puente del Sidebar (`start-recording-from-sidebar`).
- **Píldora de grabación**: contenedor en `z-30` + `pointer-events-none` (interior `pointer-events-auto`); NO subir a `z-50`.
- **Todo `onCloseRequested` de JS DEBE hacer `event.preventDefault()`** — sin él `@tauri-apps/api` llama `destroy()` y mata la app con jornada activa (así se embarcó en la 0.2.57 de la Store).
- **Bundle de arranque (#24)**: `framer-motion` SOLO bajo `features/auth/**` (registro; chunk dinámico) — las entradas del resto son keyframes de `globals.css` sin `forwards`; `recharts` SOLO en `CommunicationTrendChart.tsx` vía `LazyCommunicationTrendChart` (`dynamic`); `next/font` SOLO en `app/(main)/chat/page.tsx`, nunca en el root layout. Guard post-build: `scripts/lint-main-bundle.js` (marcadores + presupuesto + `@font-face`).

## Telemetria y diagnostico remoto

Inventario completo, queries SQL y runbook en **`docs/TELEMETRIA.md`**: pirámide de 3 niveles — (1) `health.heartbeat` (JS + latido nativo del `mem_sampler`, #14) a `maity.platform_logs`; (2) `app.error` con rate-limit; (3) logs completos SOLO locales — los logs crudos NO van a la nube (decisión jul-2026); la única salida es el bundle de incidente CON consentimiento (`logging/incident.rs`, #61: nunca automático).

**El doc es contrato ejecutable:** evento nuevo = 3 entradas — `lib/telemetry-events.ts` + `logging/telemetry/catalog.rs` + fila en el doc — verificadas por `scripts/lint-telemetry.js` en el pre-build (single writer de `insert_platform_log`, naming dot-namespaced, `core:app:default` en toda capability). `scripts/lint-tauri-acl.js` cruza los call sites que exigen permiso contra las capabilities POR VENTANA (entradas aux: `app/(aux)/<label>/page.tsx` + `app/(aux)/layout.tsx`; `app/(main)/layout.tsx` es solo-main por estructura). La analítica de las ventanas aux (`trackAux`) va por el outbox nativo y sigue fuera del catálogo, como `Analytics.track`. Escapes: `// telemetry-allow:` / `// acl-allow:`. Todo evento nuevo Rust↔TS exige entrada gemela en `events.rs` + `lib/tauri-events.ts` (lint pre-build).

**Auditoría de recursos (sep-2026):** el inventario vive en `docs/AUDITORIA_RECURSOS_2026-09-02.md` (35 hallazgos anclados a `file:line`). El **estado** de cada hallazgo NO está en el md: vive en la base de datos del artifact [Huella de recursos de Maity](https://claude.ai/code/artifact/3f618734-11a8-4d9d-998c-22db7e994bd2) (colección `hallazgos`, **ausencia de documento = pendiente**), y se lee/escribe desde Claude Code con `Artifact action:read_db|write_db`. Al cerrar un hallazgo: marcarlo ahí en el mismo ciclo que el commit.

## Depuracion

```bash
RUST_LOG=app_lib::audio=debug ./clean_run.sh                    # macOS
$env:RUST_LOG="debug"; ./clean_run_windows.bat                   # Windows
# DevTools: Cmd+Shift+I (macOS) | Ctrl+Shift+I (Windows)
# Exportar logs: Settings -> Logging -> Export, o invoke('export_logs')
```

**ChunkLoadError Recovery** (dev): script inline en `layout.tsx` (`beforeInteractive`) detecta `ChunkLoadError` y recarga (max 3 intentos); si persiste, reiniciar `pnpm run tauri:dev`. Backup: `ChunkErrorRecovery.tsx`. Métricas del pipeline (buffers, tasa VAD, backpressure) visibles en la consola durante grabación.

## Plataformas y GPU

| Plataforma | Captura de Audio | GPU | Dependencias Clave |
|---|---|---|---|
| macOS 13+ | ScreenCaptureKit + BlackHole | Metal+CoreML (auto) | Permisos mic + screen recording |
| Windows | WASAPI loopback | CUDA (NVIDIA) o Vulkan (AMD/Intel) | VS Build Tools 2022, LLVM (`winget install LLVM.LLVM`) |
| Linux | ALSA/PulseAudio | CUDA o Vulkan | cmake, llvm, libomp |

**FFmpeg ya no es dependencia de nadie**: macOS y Windows lo bundlean como sidecar; sólo Linux lo resuelve por PATH. Recetas, licencias LGPL, regla exe-folder-first, resolver reintentable y qué entrypoints stagean: `docs/BUILDING.md` § ffmpeg. En Windows, todo `tauri dev/build` stagea ffmpeg antes (`stage-ffmpeg-windows.js`); los escapes `:skip-checks` no lo hacen a propósito.

**LLVM en Windows**: requerido por `whisper-rs-sys` (bindgen necesita `libclang.dll`). Configurar `LIBCLANG_PATH=C:\Program Files\LLVM\bin`.

**Features de Cargo.toml**:
```
metal, coreml      → macOS (auto)                       [whisper-rs]
cuda               → Windows/Linux NVIDIA               [whisper-rs]
vulkan             → Windows/Linux AMD/Intel            [whisper-rs]
hipblas            → Linux AMD ROCm                     [whisper-rs]
openblas, openmp   → Optimizacion CPU                   [whisper-rs]
onnx-directml      → Windows: DirectML para los motores ONNX. OFF por defecto (#33); ver docs/ONNX_EXECUTION_PROVIDERS.md
```

**Dependencias Rust**: una sola pila TLS (rustls 0.23 + ring vía `rustls-no-provider` + `install_crypto_provider()` en `main.rs` ANTES de `init_sentry()`), cero deps duplicadas/muertas; `cargo tree -i aws-lc-rs` debe estar vacío. Política completa y lint (`lint-cargo-deps.js`): `docs/BUILDING.md` § #35.

## Configuracion Multiplataforma

Tauri 2.x mergea configs por plataforma con el base via JSON Merge Patch (RFC 7396):

```
frontend/src-tauri/
├── tauri.conf.json              # Config BASE compartida (todas las plataformas)
├── tauri.macos.conf.json        # Overrides macOS: externalBin = llama-helper + ffmpeg
├── tauri.windows.conf.json      # Overrides Windows: externalBin = llama-helper + ffmpeg; resources = templates + vcredist
├── tauri.appstore.conf.json     # Canal Mac App Store (se aplica ENCIMA del de macOS via --config)
├── entitlements*.plist          # Entitlements: directa / App Store (sandbox) / inherit para sidecars
└── Info.plist                   # Permisos macOS (NUNCA eliminar las *UsageDescription) + ITSAppUsesNonExemptEncryption=false
```

Ojo: `tauri.<plataforma>.conf.json` **reemplaza** el array `externalBin`, no lo concatena — repetir `binaries/llama-helper` en ambos overrides. **Nunca `bundle.resources`** para ejecutables en macOS.

### Reglas CRITICAS

1. **`tauri.conf.json` es la config BASE compartida** — NO modificar para una sola plataforma. Usar `tauri.{platform}.conf.json` para overrides.
2. **NUNCA cambiar el `identifier`** (`com.maity.ai`) — Rompe datos de usuarios existentes (SQLite, modelos, config) porque el OS almacena datos por identifier.
3. **NUNCA eliminar permisos de `Info.plist`** (`NSMicrophoneUsageDescription`, `NSScreenCaptureUsageDescription`, `NSAudioCaptureUsageDescription`) — macOS los requiere para mostrar el dialogo de permisos.
4. **NUNCA commitear artefactos de build** (`.pkg`, `.dmg`, `.msi`, `*-setup.exe`) — usar GitHub Releases.
5. **NUNCA eliminar la config `bundle.windows`** del `tauri.conf.json` base — contiene signing, idioma de instaladores, etc.
6. **El sistema `visible: false` + `app-ready`** en `lib.rs` y `layout.tsx` es intencional — evita pantalla negra al inicio. No eliminar.

### CI/CD (GitHub Actions)

`.github/workflows/`: `build-windows.yml` (DigiCert HSM signing), `build-macos.yml` (Apple notarization), `build-linux.yml` (deb + AppImage), `build-devtest.yml`, `build-test.yml`, `pr-main-check.yml`, `release.yml`.

## Nube: Supabase, Deepgram y Meeting Detector

- **Cliente Supabase**: ver § Cuentas, nube y análisis (arriba) y `docs/NUBE_CUENTAS_SYNC.md`.
- **Deepgram** via Cloudflare Worker proxy — **la API key nunca llega al cliente**; token JWT de 5 min de Vercel `/api/deepgram-token`; el Worker `maity-deepgram-proxy` es el único que conoce la key. Default: Nova-3, `es-419` (persiste en `transcript_settings` de SQLite). **No recrear `supabase/functions/`** (#67; ESLint bloquea `supabase.functions.invoke(`). Gotchas de JWT y tabla de archivos: `docs/NUBE_CUENTAS_SYNC.md`.
- **Meeting Detector: APAGADO por `DETECTOR_KILL_SWITCH = true`** (`meeting_detector/mod.rs`; independiente de `settings.enabled`). **NO borrar el módulo** — `scheduled_recording` reusa su `ProcessMonitor`. Todo campo nuevo en `MeetingDetectorSettings` lleva `#[serde(default)]` o el parse resetea las preferencias en silencio. Criterios anti-falsos-positivos y cómo reactivar: `docs/REGLAS_AUDIO_GRABACION.md` § Meeting Detector.

## Restricciones Importantes

1. **Frecuencia de muestreo**: el pipeline espera 48kHz consistente; el remuestreo ocurre al capturar.
2. **Audio por plataforma**: macOS requiere ScreenCaptureKit (13+) + permiso de screen recording. Windows WASAPI modo exclusivo puede conflictuar con otras apps.
3. **Grabacion stereo**: entrelazada (L=mic, R=sistema); `IncrementalAudioSaver` con checkpoints de 30s y `channels=2`.
4. **Rutas de archivos**: usar APIs de rutas de Tauri (`downloadDir`, etc.); nunca hardcodear rutas.
5. **Permisos macOS**: microfono Y grabacion de pantalla para audio del sistema.

## Convenciones del Repositorio

- **Manejo de errores**: Rust usa `anyhow::Result`; frontend try-catch con mensajes amigables.
- **Nomenclatura audio**: siempre "microphone" y "system" (no "input"/"output").
- **Claves de `invoke()` en camelCase**: los comandos Tauri sin `rename_all` esperan camelCase (`micDeviceName`, no `mic_device_name`). Con snake_case las claves no matchean y los `Option<String>` llegan como `None` SIN error — así se rompió `start_recording_with_devices_and_meeting` durante meses. El preflight `resolve_actual_endpoint` (`recording_helpers.rs`) verifica qué endpoint abrirá WASAPI de verdad y adopta su nombre real.
- **Identificador de dispositivo**: nombre CRUDO del OS sin sufijo `(input)/(output)` (helper `lib/deviceName.ts`); la selección se persiste SOLO vía `ConfigContext.updateSelectedDevices` (NO cablear escritores nuevos al setter crudo); preferencias nuevas de grabación = campo de `RecordingPreferences` con `#[serde(default)]` + control DENTRO de `RecordingSettings.tsx` (`set_recording_preferences` reemplaza el objeto ENTERO). Matcher de nombres, monitor de dispositivos (#17), Bluetooth guard y level monitor: `docs/REGLAS_AUDIO_GRABACION.md`.
- **Ramas de Git**: se trabaja **directo en `main`**. NO crear ramas (`fix/*`, `enhance/*`, `feat/*`) por iniciativa propia — solo si el usuario lo pide explicitamente. El **push lo decide el usuario**: commit local, nada de `git push` sin que lo pida.
- **Commits**: prefijos estandar (`feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`, `chore:`) con descripcion en espanol.

---

## Protocolo Guardian - Modo Protegido

### 1. Respaldo Pre-Cambio (Solo Alto Riesgo)

Crear rama de backup **antes** de cambios de alto riesgo:
- Refactoring grande (>3 archivos o >200 lineas)
- Cambios en pipeline de audio (`pipeline.rs`, `recording_manager.rs`)
- Cambios en motor de transcripcion (`engine.rs`, `worker.rs`)
- Modificaciones a `lib.rs` o al sistema de comandos Tauri

```bash
git checkout -b backup/{fecha}-{descripcion-corta}
git checkout -    # Volver a la rama de trabajo
```

**NO se requiere backup para**: edits menores, correcciones puntuales, cambios de UI, actualizaciones de dependencias.

### 2. Protocolo de Compilacion (OBLIGATORIO — SIN EXCEPCIONES)

**REGLA ABSOLUTA**: Despues de CADA cambio de codigo, se DEBE ejecutar el build completo integrado de Tauri. NUNCA se debe entregar, hacer commit, ni reportar completado sin que el build haya pasado con exit code 0.

```bash
cd frontend && pnpm run tauri:build:debug     # OBLIGATORIO - Build integrado Tauri (debug)
```

Este comando ejecuta: `pnpm build` (Next.js) -> `cargo build` (Rust, debug) -> empaqueta frontend + backend en un ejecutable funcional.

**Criterio de exito**: Exit code 0. Si termina con exit code != 0, el build NO paso — corregir antes de entregar.

**Nota sobre firma local**: El script `tauri-auto.js` maneja la ausencia de `TAURI_SIGNING_PRIVATE_KEY` en desarrollo local (warning + exit 0, comportamiento esperado).

**PROHIBIDO**:
- Usar `cargo build` como build final (solo compila Rust, no integra frontend)
- Hacer commit sin build exitoso (exit code 0)
- Reportar tarea completada sin build exitoso

**Artefactos debug**: `target/debug/maity-desktop.exe`, `target/debug/bundle/msi/Maity_*.msi`, `target/debug/bundle/nsis/Maity_*-setup.exe`

**Build de produccion** (solo para releases): `cd frontend && pnpm run tauri:build`

> **GC del `target/`**: `gc-target-dir.js` corre como primer paso del pre-build y de `tauri:dev` (el incremental de Cargo llegó a 43.7 GB y mató un build con disco lleno). Manual: `pnpm run target:gc` / `target:gc:dry`. **Nightshift bloquea `rm -r`/`Remove-Item -Recurse` en duro** — por eso el borrado vive en un script de Node. Umbrales, escapes y detalle: `docs/BUILDING.md` § GC del target/.

### 3. Alerta de Cambios Peligrosos

Si el usuario solicita alguna de estas acciones, **advertir y proponer enfoque incremental**:
- Eliminar archivos completos del sistema de audio
- Reescribir modulos enteros desde cero
- Cambiar la arquitectura del pipeline de audio
- Modificar el formato de comunicacion Rust <-> Frontend

Formato: > **Cambio de alto riesgo detectado**: [descripcion]. Este cambio afecta [componentes]. Propongo un enfoque incremental: [pasos].

### 4. Formato de Commits

Prefijos estandar con descripcion en espanol: `feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`, `chore:`

Ejemplo: `feat: agregar grabacion stereo dual-canal (L=mic, R=sistema)`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
