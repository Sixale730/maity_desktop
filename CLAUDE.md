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

## Skills (Slash Commands)

### `/build [patch|minor|major]`
Build firmado de produccion con bump automatico de version semver. Lee signing keys de `frontend/.env`, actualiza la version en 4 archivos (`tauri.conf.json`, `package.json`, `Cargo.toml` y `Package.appxmanifest` — este ultimo en formato MSIX de 4 partes `X.Y.Z.0`), y ejecuta `pnpm run tauri:build` con las credenciales de firma. Definicion: `.claude/skills/build/SKILL.md`

### `/store-msix`
Empaqueta y publica Maity en la Microsoft Store (canal paralelo a GitHub Releases, sin SmartScreen). Pipeline **independiente** del build normal: `tauri build --no-bundle` → staging del payload → `winapp package` → Partner Center. No usa Certum ni el updater de Tauri (Microsoft re-firma el `.msix`; el updater se auto-desactiva bajo identidad de paquete). Definicion: `.claude/skills/store-msix/SKILL.md`

> **VC++ Runtime app-local (ambos canales):** el binario enlaza C++ compilado con `/MD` (whisper.cpp, ONNX Runtime, `llama-helper`), asi que depende de `MSVCP140.dll`, `MSVCP140_1.dll`, `VCRUNTIME140.dll` y `VCRUNTIME140_1.dll`. En maquinas de desarrollo ese runtime siempre esta instalado, pero en un **Windows limpio la app no arranca** — fue lo que rebote la certificacion de la Store (politica 10.2.4.1, jul-2026) y afectaba igual al `.exe` de GitHub Releases. `frontend/scripts/stage-vcredist.js` copia los 4 DLLs del VS Build Tools a `frontend/src-tauri/vcredist/` (gitignored; se regenera en cada build para que la version coincida con el toolset que compilo). Los reparte `frontend/src-tauri/tauri.windows.conf.json` via `bundle.resources` en forma de **mapa** con destino `""` (raiz del resource dir = el dir del `.exe`); para MSIX se copian a mano al staging. **Todo `.dll` nuevo del que dependa un binario debe viajar dentro del paquete** — las `api-ms-win-crt-*.dll` son la excepcion (UCRT, parte de Windows 10+).

> **Consecuencia de los dos canales:** **las migraciones deben ser ADITIVAS**. La Store va dias atras por certificacion, asi que un usuario puede abrir una version vieja despues de que una nueva migro su DB: agregar tablas/columnas OK; un `DROP` o `RENAME` de algo que lee la version vieja rompe. El build de verificacion NO detecta esto — compila verde.
>
> **CORRECCION (2026-07-27) — el MSIX INSTALADO SI redirige AppData.** Este bloque afirmaba que ambos canales escriben la misma SQLite en `%APPDATA%\com.maity.ai`. Es falso para un MSIX instalado de verdad: sus datos viven en `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\LocalCache\Roaming\com.maity.ai\` (verificado: sqlite + `onboarding-status.json` + `models\` con escrituras vivas, y `%APPDATA%\com.maity.ai` sin crearse). La verificacion previa (07-20) se hizo con `winapp run`, que registra archivos sueltos y **no** redirige — de ahi el error. Implicaciones: (a) Store y descarga directa **NO** comparten DB ni modelos, asi que migrar de un canal al otro **NO** conserva los datos y obliga a re-descargar los modelos (~1.6 GB); (b) la regla aditiva sigue en pie, pero por el version-skew dentro de un mismo canal, no por una DB compartida.

> **Doble instalación (Store + descarga directa):** si un usuario tiene AMBAS, la más nueva migra la DB compartida hacia adelante y la más vieja (anterior a `set_ignore_missing(true)`, v0.2.51) truena al abrirla (`migration ... was previously applied but is missing`). Mitigación **implementada y verificada** (dirección Store→quitar NSIS): bajo MSIX, Maity detecta la instalación NSIS rival al arranque y **exige** quitarla (diálogo forzado, sin "Más tarde"). Rust: `src-tauri/src/rival_install.rs` (`get_rival_install`/`uninstall_rival`, dep `winreg`). **Gotcha clave:** el uninstaller NSIS mata `maity-desktop.exe` por NOMBRE de imagen → cierra también la MSIX (mismo exe); por eso `uninstall_rival` NO corre el uninstaller in-process sino que lanza un orquestador `.cmd` **desacoplado del job MSIX** (`cmd.exe` con `CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB` — **nunca** con `DETACHED_PROCESS`, es mutuamente excluyente y rompe el spawn) que desinstala, espera, limpia `Run\Maity` y **relanza la MSIX** por su AUMID. Frontend: `components/rival-install/RivalInstallDialog.tsx` (pull-based, solo Windows, modal forzado), montado en `layout.tsx`. `useAutostartBootstrap.ts` salta el autostart bajo MSIX. Detalle en `.claude/skills/store-msix/SKILL.md` → "Riesgo abierto: doble instalación".

### `/store-listing`
Complemento de `/store-msix` para llenar la **ficha** de la Microsoft Store (Partner Center). Abre en el **Explorador** los assets ya seleccionados (para arrastrarlos) y abre `copiar-textos.html` con los textos en español copiables con un botón por sección (Description, What's new, Product features). Todo vive en `store_listing_assets/` (raíz del repo): `logos/` (poster 9:16 `720x1080`, box art 1:1 `2160x2160`, tiles `300/150/71`), `screenshots/` (capturas reales pendientes) y `textos-es.md`. Los logos son los **originales azules `#485DF4` + logo blanco** (wordmark "maity" solo en el poster; box/tiles solo icono), respaldados de `G:\alfon\Descargas`. Posicionamiento del copy: **coach de comunicación** (Maity Chat, lectura de docs, slides, calendario/briefing, minutas). Definicion: `.claude/skills/store-listing/SKILL.md`.

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
# macOS
./build_whisper.sh small              # Compilar Whisper con modelo 'small'
./clean_start_backend.sh              # Iniciar servidor FastAPI (puerto 5167)

# Windows
build_whisper.cmd small               # Compilar Whisper con modelo
clean_start_backend.cmd               # Iniciar servidor

# Docker (Multiplataforma)
./run-docker.sh start --interactive   # macOS/Linux
.\run-docker.ps1 start -Interactive   # Windows
```

**Modelos Whisper**: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` (variantes `.en` disponibles)

### Endpoints
- **API Backend**: http://localhost:5167 (opcional, para persistencia y resumenes LLM)
- **Documentacion Backend**: http://localhost:5167/docs
- **Frontend Dev**: http://localhost:3118

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Frontend (App de Escritorio Tauri)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  UI Next.js  │  │ Backend Rust │  │ Motores STT │  │  Meeting   │  │
│  │  (React/TS)  │<>│ (Audio+IPC)  │<>│ Whisper/    │  │  Detector  │  │
│  │  9 contextos │  │ 16 modulos   │  │ Parakeet/   │  │ Zoom/Teams │  │
│  └──────────────┘  └──────────────┘  │ Moonshine   │  │ Meet       │  │
│         |                  |         └─────────────┘  └────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ Sync Queue   │  │  SQLite DB   │  │ Notificac.  │  │  Logging   │  │
│  │ (offline-1st)│  │ 7 reposit.   │  │  DND/mgr    │  │  rotativo  │  │
│  └──────────────┘  └──────────────┘  └─────────────┘  └────────────┘  │
└─────────┬────────────────────────────────────────────────────────────── ┘
          │ HTTP/WebSocket (opcional)
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│   Backend (FastAPI + SQLite)     │     Cloud (Supabase + Vercel API)    │
│   Persistencia local + LLM      │     Auth, sync, analysis, proxy      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Modulos Rust (16 modulos en `src-tauri/src/`)

| Modulo | Descripcion |
|--------|-------------|
| `audio/` | Pipeline de audio completo (46 archivos): captura, VAD, mezcla, grabacion, transcripcion |
| `whisper_engine/` | Motor Whisper.cpp con procesamiento paralelo y aceleracion GPU |
| `parakeet_engine/` | Motor Parakeet ONNX (~150MB, rapido on-device) |
| `moonshine_engine/` | Motor Moonshine ONNX (ultra-rapido, dual decoder) |
| `canary_engine/` | Motor NVIDIA NeMo Canary (mejor espanol, **existe pero NO expuesto en lib.rs**) |
| `summary/` | Generacion de resumenes: LLM client, templates, communication evaluator |
| `database/` | SQLite con 7 repositorios: meeting, transcript, transcript_chunk, summary, setting, recording_log, sync_queue |
| `api/` | Cliente HTTP para backend + endpoints + finalizacion cloud |
| `meeting_detector/` | Detecta Zoom/Teams/Meet activos, auto-record opcional |
| `notifications/` | Sistema de notificaciones con DND, consent, y sistema nativo |
| `logging/` | Logger rotativo a archivo con export y limpieza |
| `analytics/` | Event tracking (PostHog) |
| `ollama/` | Cliente Ollama (modelos locales) |
| `openrouter/` | Cliente OpenRouter API |
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

### Estructura del Modulo de Audio (46 archivos)

```
audio/
├── devices/                    # Descubrimiento y configuracion de dispositivos
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   ├── microphone.rs          # default_input_device
│   ├── speakers.rs            # default_output_device
│   ├── configuration.rs       # Tipos AudioDevice, parsing
│   ├── fallback.rs            # Seleccion de dispositivo fallback
│   └── platform/              # Implementaciones por plataforma
│       ├── windows.rs         # Logica WASAPI
│       ├── macos.rs           # Logica ScreenCaptureKit
│       └── linux.rs           # Logica ALSA/PulseAudio
├── capture/                   # Captura de streams de audio
│   ├── microphone.rs          # Stream de captura de microfono
│   ├── system.rs              # Stream de captura de audio del sistema
│   ├── core_audio.rs          # Integracion ScreenCaptureKit macOS
│   ├── wasapi_loopback.rs     # Windows WASAPI loopback
│   └── backend_config.rs      # Configuracion de backend de audio
├── transcription/             # Motor de transcripcion (12 archivos)
│   ├── engine.rs              # Gestion de motores (Whisper + Parakeet + Moonshine)
│   ├── worker.rs              # Pool de workers de transcripcion (54KB, el mas grande)
│   ├── provider.rs            # Interfaz abstracta de proveedores
│   ├── whisper_provider.rs    # Proveedor Whisper
│   ├── parakeet_provider.rs   # Proveedor Parakeet
│   ├── canary_provider.rs     # Proveedor Canary (existe, canary_engine no expuesto)
│   ├── deepgram_provider.rs   # Proveedor Deepgram (nube, WebSocket, 33KB)
│   └── deepgram_commands.rs   # Comandos Tauri para proxy config
├── pipeline.rs                # Mezcla de audio, VAD y distribucion
├── recording_manager.rs       # Coordinacion de grabacion de alto nivel
├── recording_commands.rs      # Interfaz de comandos Tauri
├── recording_lifecycle.rs     # Lifecycle: start, stop, pause, resume
├── recording_state.rs         # Estado compartido de grabacion
├── recording_saver.rs         # Escritura de archivos de audio
├── recording_helpers.rs       # Funciones auxiliares
├── recording_preferences.rs   # Preferencias de grabacion
├── incremental_saver.rs       # Guardado incremental con checkpoints (30s)
├── stream.rs                  # StreamBackend abstraction (CPAL + CoreAudio)
├── encode.rs                  # Codificacion FFmpeg (PCM -> AAC/MP4)
├── ffmpeg.rs                  # Wrapper FFmpeg CLI
├── ffmpeg_mixer.rs            # Mezcla con FFmpeg + adaptive ducking (19KB)
├── device_monitor.rs          # Monitoreo de dispositivos (connect/disconnect)
├── device_detection.rs        # Deteccion de tipo de dispositivo
├── hardware_detector.rs       # Deteccion de hardware (GPU, CPU)
├── playback_monitor.rs        # Deteccion de Bluetooth (warnings)
├── vad.rs                     # Voice Activity Detection
├── level_monitor.rs           # Monitor de niveles de audio en tiempo real
├── simple_level_monitor.rs    # Monitor simplificado
├── audio_processing.rs        # Normalizacion y efectos
├── buffer_pool.rs             # Pool pre-asignado de buffers
├── batch_processor.rs         # Procesamiento por lotes
├── post_processor.rs          # Post-procesamiento
├── diagnostics.rs             # Logging de diagnostico
├── async_logger.rs            # Logger asincrono
├── system_audio_commands.rs   # Comandos Tauri para audio del sistema
├── system_audio_stream.rs     # Stream de audio del sistema
├── system_detector.rs         # Deteccion de eventos de audio del sistema
└── permissions.rs             # Permisos de screen recording
```

**Al trabajar en funcionalidades de audio**:
- Deteccion de dispositivos -> `devices/discovery.rs` o `devices/platform/{windows,macos,linux}.rs`
- Microfono/altavoces -> `devices/microphone.rs` o `devices/speakers.rs`
- Captura de audio -> `capture/microphone.rs` o `capture/system.rs`
- Mezcla/procesamiento -> `pipeline.rs`
- Flujo de grabacion -> `recording_manager.rs` + `recording_lifecycle.rs` + `recording_state.rs`
- Guardado -> `recording_saver.rs` + `incremental_saver.rs`
- Transcripcion local -> `transcription/engine.rs` + `transcription/worker.rs`
- Transcripcion nube -> `transcription/deepgram_provider.rs`
- Hot-swap de dispositivos -> `device_monitor.rs` + `recording_lifecycle.rs`
- Codificacion -> `encode.rs` + `ffmpeg.rs` + `ffmpeg_mixer.rs`

### Motores de Transcripcion (4 locales + 1 nube)

| Motor | Tipo | Archivos | Caracteristicas |
|-------|------|----------|-----------------|
| **Whisper** | Local, GPU | `whisper_engine/` (6 archivos) | Procesamiento paralelo, Metal/CUDA/Vulkan, modelos tiny→large-v3 |
| **Parakeet** | Local, ONNX | `parakeet_engine/` (4 archivos) | ~150MB, rapido on-device, auto-download |
| **Moonshine** | Local, ONNX | `moonshine_engine/` (4 archivos) | Ultra-rapido, dual decoder (encoder-only + with-past) |
| **Canary** | Local, ONNX | `canary_engine/` (5 archivos) | NVIDIA NeMo, mejor espanol (2.69% WER), **NO EXPUESTO en lib.rs** |
| **Deepgram** | Nube, WS | `transcription/deepgram_*.rs` | Via Cloudflare Worker proxy, Nova-3 |

### Sistema de Resumen (`summary/`, 11 archivos)

```
summary/
├── service.rs                 # Servicio principal: chunking, LLM orchestration
├── processor.rs               # Chunking y generacion de resumen
├── llm_client.rs              # Multi-provider (Claude, OpenAI, Groq, Ollama, OpenRouter, Custom)
├── communication_evaluator.rs # Evaluacion de comunicacion post-reunion
├── communication_types.rs     # Tipos para CommunicationFeedback
├── commands.rs                # api_process_transcript, api_get_summary, etc.
├── template_commands.rs       # api_list_templates, api_get_template_details, etc.
├── templates/                 # Plantillas de resumen
│   ├── loader.rs, defaults.rs, types.rs
└── summary_engine/            # Motor AI built-in para resumenes
    ├── model_manager.rs, sidecar.rs, client.rs, models.rs, commands.rs
```

### Base de Datos Local (`database/`, 9 archivos)

```
database/
├── manager.rs                 # DatabaseManager (SQLite connection pool)
├── setup.rs                   # Schema init y migraciones
├── models.rs                  # Tipos Rust para entidades DB
├── commands.rs                # Comandos Tauri (legacy import, event logging)
├── sync_queue_commands.rs     # Comandos de sync queue offline-first
└── repositories/              # Data access layers
    ├── meeting.rs             # MeetingsRepository
    ├── transcript.rs          # TranscriptRepository
    ├── transcript_chunk.rs    # TranscriptChunkRepository
    ├── summary.rs             # SummaryProcessesRepository
    ├── setting.rs             # SettingsRepository
    ├── recording_log.rs       # RecordingLogRepository
    └── sync_queue.rs          # SyncQueueRepository (offline-first cloud)
```

### Sistema de Sync Queue (Offline-First)

Cola de trabajos para sincronizacion con la nube que funciona offline. Cada grabacion genera jobs (meeting, transcripts, summary) con dependencias. Comandos Tauri: `sync_queue_enqueue`, `sync_queue_claim_job`, `sync_queue_complete_job`, `sync_queue_fail_job`, `sync_queue_get_all_statuses`, etc.

### Comunicacion Rust <-> Frontend

Comandos via `invoke()` (Frontend->Rust), Eventos via `emit()`/`listen()` (Rust->Frontend). Todos los comandos registrados en `lib.rs`.

**Grupos de comandos Tauri principales**:
- **Grabacion**: `start_recording`, `stop_recording`, `pause_recording`, `resume_recording`, `is_recording_paused`, `get_recording_state`, `get_meeting_folder_path`
- **Dispositivos**: `list_audio_devices`, `switch_audio_device`, `poll_audio_device_events`, `attempt_device_reconnect`, `get_reconnection_status`, `get_active_audio_output`
- **Transcripcion**: `cancel_pending_transcription`, `recover_audio_from_checkpoints`, `cleanup_checkpoints`, `has_audio_checkpoints`
- **Whisper paralelo**: `initialize_parallel_processor`, `start_parallel_processing`, `pause/resume/stop_parallel_processing`, `get_parallel_processing_status`, `get_system_resources`
- **Deepgram proxy**: `fetch_deepgram_proxy_config`, `set/get/clear_deepgram_proxy_config`, `has_valid_deepgram_proxy_config`
- **Sync queue**: `sync_queue_enqueue`, `sync_queue_claim_job`, `sync_queue_complete_job`, `sync_queue_fail_job`, `sync_queue_get_all_statuses`, `sync_queue_cancel_meeting`, etc.
- **Meeting detector**: `start/stop_meeting_detector`, `is_meeting_detector_running`, `get_active_meetings`, `check_for_meetings_now`, `respond_to_meeting_detection`, `set_meeting_auto_record`, etc.
- **Notificaciones**: `get/set_notification_settings`, `show_notification`, DND status
- **Logging**: `get_log_info`, `export_logs`, `open_log_directory`, `clear_old_logs`
- **OAuth**: `start_oauth_server`, `get_pending_auth_code`, `get_pending_auth_tokens`
- **Sistema audio**: `start_system_audio_capture_command`, `list_system_audio_devices_command`, `check_system_audio_permissions_command`, `start/stop_system_audio_monitoring`

**Patron de estado**: Comandos Tauri actualizan estado Rust -> Emiten eventos -> Listeners del frontend actualizan estado React -> El contexto se propaga a los componentes.

### Gestion de Modelos Whisper

**Ubicaciones de Almacenamiento**:
- **Desarrollo**: `frontend/models/`
- **Produccion (macOS)**: `~/Library/Application Support/com.maity.ai/models/`
- **Produccion (Windows)**: `%APPDATA%\com.maity.ai\models\`

Los modelos se cargan una vez y se cachean. Cambiar modelos requiere reinicio de la app o descarga/recarga manual. Auto-deteccion de GPU (Metal/CUDA/Vulkan) con fallback a CPU.

## Arquitectura Frontend

### Paginas (Routes)

| Ruta | Archivo | Descripcion |
|------|---------|-------------|
| `/` | `app/page.tsx` | Interfaz principal de grabacion |
| `/conversations` | `app/conversations/page.tsx` | Lista de conversaciones (local-first) |
| `/meeting-details` | `app/meeting-details/page.tsx` | Detalle de reunion con auto-summary |
| `/gamification` | `app/gamification/page.tsx` | Dashboard gamificado (volcan de progreso) |
| `/notes` | `app/notes/page.tsx` | Notas extraidas de conversaciones |
| `/tasks` | `app/tasks/page.tsx` | Tareas extraidas de conversaciones |
| `/settings` | `app/settings/page.tsx` | Configuracion de la app |
| `/registration` | `app/registration/page.tsx` | Onboarding de registro (avatar 3D + cuestionario 17 pasos) — solo usuarios con `registration_form_completed=false` |
| `/billing/plans` | `app/billing/plans/page.tsx` | Seleccion de plan (Free/Pro/Enterprise) — checkout Pro abre navegador externo via handoff |

### Gate de Registro (`useRegistrationGate` + `AppContent` en `layout.tsx`)

Orden de ramas en `AppContent` para cuentas nuevas:
1. Onboarding tecnico (**Welcome** + Permissions macOS) — la pantalla de bienvenida (`WelcomeStep`, "Bienvenido a Maity", con logo) es la ÚNICA con arranque de modelos. Su botón **"Comenzar y descargar"** arranca Parakeet **+** Gemma en background vía `startBackgroundDownloads(true)` y **avanza al instante** (Windows → registro; macOS → permisos, la descarga sigue en background). NO bloquea. Muestra el total dinámico (~1.6 GB Windows / ~3 GB macOS). (La antigua pantalla "Tu IA personal"/`ModelDownloadStep` fue eliminada.)
2. Splash mientras `modelGateActive` resuelve (`null` → comprobando)
3. Splash (`registrationLoading`)
4. Rama de registro: `/registration` (17 pasos) con `OnboardingDownloadWidget` en la esquina reportando progreso de las descargas en background
5. **`ModelDownloadGate`** — gate bloqueante que espera a Parakeet si falta en disco
6. Scheduled setup gate
7. Main app — el `OnboardingDownloadWidget` sigue mostrando el progreso de Gemma; el usuario ya puede navegar.

**SÍ hay pantalla de espera bloqueante, pero SOLO para Parakeet** (`components/ModelDownloadGate/`, restaurado en jul-2026 tras el rebote 10.3.1 de la Store). Razón: sin el modelo de transcripción, `useRecordingStart.ts` aborta la grabación con un toast y **no hay fallback a otro motor** — un usuario (o un reviewer de certificación) que llega al dashboard sin modelo no puede probar la funcionalidad principal.

Reglas del gate, todas deliberadas — **no "simplificar" sin leer esto**:
- **Solo Parakeet bloquea.** Gemma (resumen) sigue en background y nunca bloquea.
- **Va DESPUÉS del registro**, para que los 17 pasos solapen con la descarga. Ponerlo antes hace que una cuenta nueva mire una barra muerta de 600 MB sin nada que hacer.
- **Sin botón de omitir.** Decisión explícita del producto.
- **Es PASIVO**: no arranca ni cancela descargas, solo observa. Quien arranca sigue siendo `WelcomeStep`/`BackgroundDownloadStarter`. Si el gate arrancara descargas, competiría con la que ya existe.
- **Orden de fases obligatorio**: `isModelReady` → `isDownloading` → `error` → `conectando`. `isModelReady` va primero porque Rust emite COMPLETE *antes* de que el comando retorne `Ok`; con `isDownloading` primero el gate no se levantaría nunca tras un reintento exitoso.
- **Sin watchdog de stall propio**: Rust ya corta a los 30 s sin bytes. Un temporizador de frontend más corto ofrecería "Reintentar" con la tarea aún viva. El único timer es el de la fase "Conectando…" (60 s), por encima del `connect_timeout` de 30 s.

`ModelDownloadStep` ("Tu IA personal") sigue eliminado — el consentimiento vive en el botón "Comenzar y descargar" de `WelcomeStep`, y el gate solo espera.

Para cuentas existentes (`get_onboarding_status.completed===true`): saltan el onboarding técnico. Si les falta el modelo, `BackgroundDownloadStarter` arranca la descarga en background (sin pantalla) y entran directo al dashboard con el widget.
- `BackgroundDownloadStarter` (`components/Onboarding/BackgroundDownloadStarter.tsx`, renderiza null, montado dentro de `OnboardingProvider`): si `completed && !(parakeetDownloaded && summaryModelDownloaded)` y no es ruta especial (`/coach-float`, `/recording-widget`, `/device-picker`) → `startBackgroundDownloads(true)` (idempotente por los guards internos). Es quien ARRANCA la descarga para cuentas existentes sin modelo; el `ModelDownloadGate` (restaurado jul-2026) es pasivo y solo la observa.
- Si `my_status()` devuelve `registration_form_completed===false` → redirige a `/registration`
- `/registration` y `/billing/plans` excluyen el Sidebar; sus pages proveen su propio scroll (`h-screen overflow-y-auto` + wrapper `min-h-full`) porque `globals.css` fija `body { overflow: hidden }`
- Al completar el form, la web invalida `['user','status']` → el gate se levanta solo
- **`OnboardingAccountBadge`** (`components/Onboarding/OnboardingAccountBadge.tsx`, `fixed top-4 right-4 z-[60]`): como el Sidebar no se monta durante el onboarding, replica el indicador de cuenta + cerrar sesión (`useAuth().signOut`). Es un **icono redondo (avatar)**; al hacer clic despliega un menú (nombre/email/botón "Cerrar sesión"); cierra al hacer clic fuera. Se monta en las ramas de onboarding: técnico (`OnboardingFlow`), registro (`/registration`), scheduled setup, y en la rama main cuando `isRegistrationRoute` (`/billing/plans`). `z-[60]` sobre overlays; top-right para no chocar con `OnboardingDownloadWidget` (bottom-right).

### Descargas de Modelos (`WelcomeStep` + `BackgroundDownloadStarter` + `OnboardingContext` + `OnboardingDownloadWidget`)

> **Concurrencia de descargas (arreglado jul-2026 — no revertir).** El arranque estaba duplicado: `WelcomeStep` dispara la descarga y completa el onboarding en el MISMO tick, lo que voltea `completed` y hace re-correr el efecto de `BackgroundDownloadStarter`, que llamaba otra vez. Como `startParakeet` tiene varios `await` antes del invoke, sus guards leían un estado que la primera llamada aún no había escrito → **toda cuenta nueva en Windows bajaba Parakeet dos veces**. Ahora `OnboardingContext` guarda la promesa del arranque (`parakeetKickoffRef`/`gemmaKickoffRef`) y la reusa. En Rust, el guard de `active_downloads` era TOCTOU (check con read lock, insert con write lock por separado) y 4 salidas `Err` no limpiaban la bandera, dejando el modelo en `Downloading{0}` para siempre. Hoy: check+insert atómico con `HashSet::insert`, y un único `remove` en el wrapper de `download_model_detailed`, que cubre todos los caminos de salida. `parakeet_retry_download` ya **no** fuerza el clear — si hay una descarga viva, no relanza (dos writers sobre el mismo `.onnx` no dan error en Windows: corrompen el archivo en silencio y pasan la validación, que es solo por tamaño).

- **Arranque en un solo lugar, no-bloqueante:**
  - **Cuentas nuevas**: `WelcomeStep` ("Bienvenido a Maity", paso 1 del onboarding técnico, con logo). Su botón "Comenzar y descargar" → `startBackgroundDownloads(true)` + (Windows) `completeOnboarding()` / (macOS) `goNext()` a permisos. Avanza al instante. Muestra el total con tamaño **dinámico por plataforma**: Parakeet ~600 MB + Gemma (`gemma3:1b` ~1 GB en Windows/RAM<16GB, `gemma3:4b` ~2.4 GB en macOS>16GB) → total ~1.6 GB / ~3 GB.
  - **Cuentas existentes sin modelo**: `BackgroundDownloadStarter` arranca la descarga en background al montar (sin pantalla).
- `OnboardingContext.startBackgroundDownloads(includeGemma)` — arranca Parakeet y opcionalmente Gemma con guards completos (idempotente):
  - Parakeet: `parakeet_init` → `parakeet_has_available_models` (skip si true) → `parakeet_get_available_models` para detectar `Downloading` (skip) y `Corrupted` (borrar con `parakeet_delete_corrupted_model` primero) → `parakeet_download_model` con `parakeet-tdt-0.6b-v3-int8`
  - Gemma (tras 3s delay para priorizar ancho de banda): `builtin_ai_is_model_ready` (skip si ready) → `builtin_ai_get_model_info` (skip si `status.type === 'downloading'`) → `builtin_ai_download_model` (`selectedSummaryModel`, recomendado por `builtin_ai_get_recommended_model`)
  - Setea `isBackgroundDownloading=true` → el widget aparece.
- **UNA sola UI de progreso de descarga**: `OnboardingDownloadWidget` (`bottom-4 right-4 z-50`), montado en la rama de registro Y en el main app. Por defecto es una **bolita redonda** con anillo de progreso (% combinado); al hacer clic se **expande al modal** completo (filas Parakeet/Gemma) y se minimiza con la X. Solo se muestra cuando hay actividad. **`DownloadProgressToastProvider` fue eliminado** del layout (antes duplicaba: toasts arriba + widget abajo).

> **El estado del onboarding es MONÓTONO y leerlo NO escribe (arreglado jul-2026 — no revertir).** `onboarding.rs::reconcile_status` solo puede **avanzar** el estado: nunca pone `completed=false` ni baja `current_step`. Retroceder el onboarding es una acción explícita del usuario (`reset_onboarding_status`), jamás un efecto de mirar el disco. Además `load_onboarding_status` es **lectura pura** (CQS) y la reconciliación corre **una sola vez** desde el `setup` de `lib.rs` (`reconcile_onboarding_status_at_startup`).
>
> **Por qué**: hasta jul-2026 el reconciliador aplicaba la regla §4.1 de `fb1846b` — "si hay gemma 1b en disco pero no 4b → `completed=false`, volver al paso 3". Pero `builtin_ai_get_recommended_model` es `if is_macos && ram > 16 { 4b } else { 1b }`, o sea **todo Windows baja el 1b por diseño** → la regla declaraba "instalación rota" justo lo que el recomendador produce. Y como `useRecordingStop` hace hard navigate (`window.location.href`), cada fin de reunión remontaba el árbol React y volvía a disparar esa escritura: **el usuario terminaba en "Bienvenido a Maity" después de cada reunión, en bucle** (se rearmaba solo porque `complete_onboarding` reescribía `summary="cloud"` y borraba el centinela). Rompía toda instalación limpia de Windows, incluida la del reviewer de la Store. La salvaguarda original ya era redundante: el coach resuelve su propio modelo con `resolve_effective_tips_model` y degrada a `Unavailable` si falta.
>
> Reglas derivadas: (a) el onboarding acepta **cualquier** modelo del registry (`summary_engine::models::any_model_on_disk`), no un modelo concreto; (b) los umbrales de tamaño viven en `ModelDef::size_bounds_mb` — no inventar umbrales nuevos por consumidor; (c) `complete_onboarding` **no toca** `model_status`: ese campo refleja el disco, no la transición; (d) `load_onboarding_status` tiene tres llamadores (`get_onboarding_status`, `OnboardingContext`, `tray::check_can_record`) — cualquier efecto secundario que se le agregue se multiplica por cada remonte del frontend. Cubierto por `#[cfg(test)] mod reconcile_tests` en `onboarding.rs`.

### Video de instrucciones (CSP)

- El paso de instrucciones del registro (`features/auth/components/registration/RegistrationInstructions.tsx`) embebe un **iframe de YouTube**. Requiere `frame-src`/`child-src` con `https://www.youtube.com` en la CSP de `frontend/src-tauri/tauri.conf.json`; sin eso WebView2 lo bloquea en el build empaquetado (en `pnpm dev` no se nota).

### Resumen built-in (Gemma) — requisitos

- El resumen con IA local usa el sidecar `llama-helper.exe` (`externalBin: ["binaries/llama-helper"]` en `tauri.conf.json`; fuente en `C:\maity_desktop\llama-helper\`, `cargo build --release -p llama-helper`). Debe existir el binario REAL en `frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe` (y en `msix_staging/llama-helper.exe` para el MSIX) — un stub de 0 bytes hace fallar el `spawn`. Además el modelo Gemma debe estar descargado (`gemma3:1b`/`gemma3:4b` según plataforma).

### Handoff de Pagos

- El desktop no tiene Stripe directamente; al elegir Pro, `useCreateCheckoutSession` construye la URL `https://www.maity.cloud/auth/handoff#access_token=...&next=/billing/plans?checkout=pro`
- `openExternalUrl` (via `lib/planLinks.ts`) abre el navegador externo del SO via `invoke('open_external_url')`
- Prerequisito: la web debe desplegar `/auth/handoff` (issue Sixale730/maity#133)
- Enterprise/anual → `/agenda` interceptado en router-compat (sin patch adicional)

### Context Providers (9, en `layout.tsx`)

Stack de providers (de exterior a interior):
1. `ThemeProvider` — Tema claro/oscuro
2. `QueryClientProvider` — React Query (5 min stale time)
3. `AuthProvider` — Google OAuth + Supabase
4. `OnboardingProvider` — Flujo de onboarding
5. `ConfigProvider` — Config de app (dispositivos, provider, idioma)
6. `RecordingPostProcessingProvider` — Procesamiento post-grabacion
7. `TranscriptProvider` — Estado de transcripciones
8. `OllamaDownloadProvider` — Descarga de modelos Ollama
9. `ParakeetAutoDownloadProvider` — Auto-descarga Parakeet
+ `RecordingStateProvider`, `AnalyticsProvider`, `UpdateCheckProvider`

**Componentes globales en layout**: `SplashScreen`, `AuthGate`, `ChunkErrorRecovery`, `ErrorBoundary`, `MeetingDetectionDialog`, `OfflineIndicator`, `CloudSyncInitializer`, `AnalysisPollingInitializer`

### Hooks (23 en `hooks/`)

| Hook | Proposito |
|------|-----------|
| `useRecordingStart` | Iniciar grabacion (logica compartida extraida) |
| `useRecordingStop` | Detener grabacion + sync cloud (fire-and-forget) |
| `useRecordingLevels` | Niveles de audio en tiempo real |
| `useRecordingStateSync` | Sincronizar estado de grabacion con Rust |
| `usePreviewLevels` | Preview de niveles antes de grabar |
| `useTranscriptStreaming` | Streaming de transcripciones en tiempo real |
| `useTranscriptionProgress` | Progreso de transcripcion con tiempo estimado |
| `useTranscriptionLag` | Profundidad de cola y lag de transcripcion |
| `useTranscriptRecovery` | Recuperacion de errores de transcripcion |
| `usePaginatedTranscripts` | Lazy-load de segmentos de transcripcion |
| `useCloudSyncStatuses` | Estado de sync cloud por conversacion |
| `useParakeetAutoDownload` | Auto-descarga de modelos Parakeet |
| `useUserRole` | Rol de usuario (developer vs regular) |
| `useNetworkStatus` | Deteccion online/offline |
| `useUpdateCheck` | Verificar actualizaciones de la app |
| `usePermissionCheck` | Verificar permisos de dispositivos |
| `usePlatform` | Detectar OS (macOS/Windows/Linux) |
| `useWindowCloseGuard` | Prevenir cierre accidental durante grabacion |
| `useAudioPlayer` | Play/pause/seek con Web Audio API |
| `useAutoScroll` | Auto-scroll con deteccion de scroll manual |
| `useNavigation` | Helpers de navegacion |
| `useProcessingProgress` | Progreso de procesamiento |
| `useModalState` | Estado de modales |

### Servicios Frontend

| Servicio | Descripcion |
|----------|-------------|
| `conversations.service.ts` | CRUD conversaciones OMI, merge local+Supabase, 40+ tipos exportados |
| `analysisPollingService.ts` | Singleton global de polling de analisis (sobrevive navegacion) |
| `cloudSyncWorker.ts` | Worker de sync cloud en background |
| `recordingLogService.ts` | Gestion de logs de grabacion |
| `configService.ts` | Servicio de configuracion |
| `transcriptService.ts` | Servicio de transcripciones |
| `updateService.ts` | Servicio de actualizaciones |

### Utilidades (`lib/`)

| Archivo | Proposito |
|---------|-----------|
| `deepgram.ts` | `getDeepgramProxyConfig()` — obtener proxy config de Vercel API |
| `roles.ts` | `getUserRole()`, `isDeveloper()`, `DEVELOPER_DOMAINS` |
| `supabase.ts` | Cliente Supabase proxy |
| `analytics.ts` | Analytics tracking |
| `canary.ts` | Estado y config de modelos Canary |
| `logger.ts` | Utilidad de logging |
| `invokeWithRetry.ts` | Wrapper de retry para invocaciones Tauri |
| `retry.ts` | Logica generica de retry con exponential backoff |
| `engines/` | Configs de motores STT: `whisper.ts`, `parakeet.ts`, `moonshine.ts`, `builtin-ai.ts`, `ollama-helpers.ts` |

### Features

**Conversaciones** (`features/conversations/`):
- `ConversationsList.tsx` — Lista local-first (SQLite primero, merge Supabase en background)
- `ConversationDetail.tsx` — Soporta `?id=` (cloud) y `?localId=` (local), polling de analisis
- `analysis/` — 12+ componentes de visualizacion (KPI, radar, emociones, patrones, insights)
- `charts/` — Graficas Recharts (emocion, gauge, participacion, timeline)
- `minuta/` — 7 componentes de minuta de reunion (acciones, decisiones, seguimiento, efectividad)
- `useAnalysisPolling.ts` — Hook de polling con fases: idle -> polling -> retrying -> completed

**Gamificacion** (`features/gamification/`):
- `GamifiedDashboard.tsx` — Dashboard principal
- `MountainMap.tsx` — SVG de volcan con nodos de progreso
- `MetricsPanel.tsx` — XP, racha, competencias
- `InfoPanel.tsx` — Ranking y muletillas

**Notas** (`features/notes/`) y **Tareas** (`features/tasks/`):
- Extraccion automatica desde analisis de conversaciones

### Sistema de Analisis V4 (Tipos Clave)

El analisis de conversaciones usa un sistema V4 con multiples dimensiones:
- `CommunicationFeedbackV4` — Estructura completa de analisis
- `AnalysisSkipped` — Marcador para analisis omitidos (palabras insuficientes)
- `MeetingMinutesData` — Minuta completa con 8 subsecciones
- Dimensiones: Objetivo, Emociones, Muletillas, Adaptacion
- Perfiles por hablante: palabras, claridad, persuasion, formalidad, emociones
- Type guards: `isAnalysisSkipped()`, `isFullAnalysis()`

## Patrones Criticos de Desarrollo

### Seguridad de Hilos y Estado Compartido
- `Arc<RwLock<T>>` para estado compartido entre tareas async, `Arc<AtomicBool>` para flags simples
- Mutex con `.lock().map_err()`, **nunca** `.lock().unwrap()` — evita panics por envenenamiento de mutex
- Ver `recording_state.rs` para el patron de referencia

### Logging Consciente del Rendimiento
- `perf_debug!()`/`perf_trace!()` para logging en rutas criticas — costo cero en builds de release (definidos en `lib.rs`)
- `AudioMetricsBatcher` (batch_processor.rs) para agrupar metricas de audio
- `AudioBufferPool` (buffer_pool.rs) para pre-asignar buffers

### Rendimiento de Audio
- El filtrado VAD reduce la carga de Whisper en ~70% (solo procesa voz)
- El guardado incremental con checkpoints de 30s previene perdida de datos por crashes
- Features de Cargo para GPU: `--features cuda`, `--features vulkan`, `--features metal`
- EBU R128 loudness normalization via `ebur128`
- Noise suppression via `nnnoiseless` (RNNoise)

### Flujo Local-First de Grabacion

```
Usuario detiene grabacion
    ↓
flush buffer (500ms) → Guardar en SQLite local
    ↓
Navegar a /meeting-details?localId=XXX (instantaneo)
    ↓
Fire-and-forget: sync cloud via sync_queue (background)
    ↓
ConversationDetail: muestra datos locales, poll cloud analysis
```

### Patron Visual: Dashboard de Gamificacion (DPI Scaling Windows)

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

**Botones "Empezar a grabar" / "Grabar otra" (estados vacíos del dashboard):** NO usar `router.push('/')` — el dashboard se renderiza EN la home (`app/page.tsx`), así que navegar a `/` es un no-op y el botón "no hace nada". Deben reutilizar el puente de grabación del Sidebar (`handleStartRecording` en `GamifiedDashboardV2.tsx`): si `pathname === '/'` → `window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'))` (escuchado en `useRecordingStart.ts`); si no → `sessionStorage.setItem('autoStartRecording','true')` + `router.push('/')` (consumido al montar la home). Es el MISMO mecanismo que el botón "Iniciar Grabación" del Sidebar (`SidebarProvider.tsx` → `handleRecordingToggle`).

### Overlay flotante de grabación (píldora inferior) — stacking vs. Sidebar

La píldora de grabación y el banner "no se detectó micrófono" (`app/page.tsx`) viven en un contenedor `fixed bottom-0 left-0 right-0` de ancho completo con gradiente decorativo `bg-gradient-to-t from-[#0a0a1a] ...`. Reglas para que NO tape el Sidebar:
- El contenedor externo va en **`z-30`** (por debajo del Sidebar `z-40`, que es opaco `bg-background`) → el Sidebar se pinta encima en su región y sus botones inferiores ("Configuración", "Acerca de", versión) quedan visibles y clicables. NO subirlo a `z-50` (regresión: la sombra tapa el menú lateral).
- El contenedor externo lleva **`pointer-events-none`** (el gradiente es decorativo) y el wrapper interior interactivo lleva **`pointer-events-auto`** → solo la píldora/banner reciben clics, el gradiente nunca bloquea al Sidebar ni al contenido del dashboard.
- La píldora interior se desplaza con `marginLeft` (`4rem`/`16rem` según `sidebarCollapsed`) para quedar en el área de contenido; sus dropdowns (`InlineDeviceSelector`, `z-[60]`) abren hacia arriba sin solaparse con el Sidebar.

### Header del Sidebar

- **Logo (`components/shared/Logo.tsx`):** rama no-colapsada muestra `/logo-collapsed.png` (28×28) + wordmark "Maity" con `text-foreground` (respeta la paleta del tema). NO usar la vieja píldora con `bg-[#f0f2fe]`/`dark:bg-blue-900/30` (fondo azul que no combina). Sigue siendo `DialogTrigger` → abre "Acerca de".
- **Búsqueda eliminada:** el input "Buscar contenido de reunión" fue removido de `Sidebar/index.tsx`. La infraestructura de búsqueda subyacente (`searchQuery`, `filteredSidebarItems`, `filteredConversations`, `searchResults`) permanece pero queda **inerte** (`searchQuery` siempre `''` → filtros devuelven la lista base). Si se reintroduce la búsqueda, volver a cablear un input a `setSearchQuery` + `searchTranscripts` (comando Tauri `api_search_transcripts`).

## Depuracion

```bash
# Habilitar logging verbose de audio
RUST_LOG=app_lib::audio=debug ./clean_run.sh                    # macOS
$env:RUST_LOG="debug"; ./clean_run_windows.bat                   # Windows

# DevTools
# macOS: Cmd+Shift+I  |  Windows: Ctrl+Shift+I

# Exportar logs
# Desde la app: Settings -> Logging -> Export
# Desde Rust: invoke('export_logs')
```

**ChunkLoadError Recovery** (modo desarrollo): Script inline en `layout.tsx` (strategy `beforeInteractive`) detecta `ChunkLoadError` y recarga automaticamente (max 3 intentos). Si persiste, reiniciar `pnpm run tauri:dev`. Componente backup: `ChunkErrorRecovery.tsx`.

**Metricas del Pipeline**: Tamanos de buffer, tasa VAD, chunks descartados, backpressure del canal de transcripcion — visibles en la consola de desarrollador durante grabacion.

## Plataformas y GPU

| Plataforma | Captura de Audio | GPU | Dependencias Clave |
|---|---|---|---|
| macOS 13+ | ScreenCaptureKit + BlackHole | Metal+CoreML (auto) | Permisos mic + screen recording |
| Windows | WASAPI loopback | CUDA (NVIDIA) o Vulkan (AMD/Intel) | VS Build Tools 2022, LLVM (`winget install LLVM.LLVM`), FFmpeg |
| Linux | ALSA/PulseAudio | CUDA o Vulkan | cmake, llvm, libomp |

**LLVM en Windows**: Requerido por `whisper-rs-sys` (bindgen necesita `libclang.dll`). Configurar `LIBCLANG_PATH=C:\Program Files\LLVM\bin`.

**Features de Cargo.toml**:
```
metal, coreml      → macOS (auto)
cuda               → Windows/Linux NVIDIA
vulkan             → Windows/Linux AMD/Intel
hipblas            → Linux AMD ROCm
openblas, openmp   → Optimizacion CPU
```

## Configuracion Multiplataforma

Tauri 2.x soporta configs por plataforma que se **mergean** con el base via JSON Merge Patch (RFC 7396):

```
frontend/src-tauri/
├── tauri.conf.json              # Config BASE compartida (todas las plataformas)
├── tauri.macos.conf.json        # Overrides para macOS (merge automatico)
├── entitlements.plist           # Entitlements para desarrollo/distribucion directa
├── entitlements-appstore.plist  # Entitlements para App Store (sandbox)
└── Info.plist                   # Permisos macOS (NUNCA eliminar las *UsageDescription)
```

### Reglas CRITICAS

1. **`tauri.conf.json` es la config BASE compartida** — NO modificar para una sola plataforma. Usar `tauri.{platform}.conf.json` para overrides.
2. **NUNCA cambiar el `identifier`** (`com.maity.ai`) — Rompe datos de usuarios existentes (SQLite, modelos, config) porque el OS almacena datos por identifier.
3. **NUNCA eliminar permisos de `Info.plist`** (`NSMicrophoneUsageDescription`, `NSScreenCaptureUsageDescription`, `NSAudioCaptureUsageDescription`) — macOS los requiere para mostrar el dialogo de permisos.
4. **NUNCA commitear artefactos de build** (`.pkg`, `.dmg`, `.msi`, `*-setup.exe`) — usar GitHub Releases.
5. **NUNCA eliminar la config `bundle.windows`** del `tauri.conf.json` base — contiene signing, idioma de instaladores, etc.
6. **El sistema `visible: false` + `app-ready`** en `lib.rs` y `layout.tsx` es intencional — evita pantalla negra al inicio. No eliminar.

### CI/CD (GitHub Actions)

Workflows en `.github/workflows/`:
- `build-windows.yml` — Build Windows con DigiCert HSM signing
- `build-macos.yml` — Build macOS con Apple notarization
- `build-linux.yml` — Build Linux (deb + AppImage)
- `build-devtest.yml` — Builds de prueba para desarrollo
- `build-test.yml` — Builds de prueba simples
- `pr-main-check.yml` — Checks para PRs a main
- `release.yml` — Build final para releases

## Deepgram via Cloudflare Worker Proxy

La transcripcion en la nube usa Deepgram a traves de un Cloudflare Worker proxy. **La API key de Deepgram nunca llega al cliente**.

**Config por defecto**: Nova-3, idioma `es-419` (espanol latinoamericano). Persiste en tabla `transcript_settings` de SQLite.

**Modelos disponibles**: `nova-3` (recomendado), `nova-2`, `nova-2-phonecall`, `nova-2-meeting`
**Idiomas**: `es-419` (LATAM), `es` (Espana), `en`, `multi` (auto-deteccion)

| Archivo | Descripcion |
|---------|-------------|
| `frontend/src/lib/deepgram.ts` | Cliente TS para obtener proxy config de Vercel API |
| `frontend/src/hooks/useRecordingStart.ts` | Obtiene proxy config antes de iniciar grabacion |
| `frontend/src-tauri/src/audio/transcription/deepgram_commands.rs` | Comandos Tauri para proxy config en cache |
| `frontend/src-tauri/src/audio/transcription/deepgram_provider.rs` | Proveedor que conecta via proxy WebSocket |
| `frontend/src-tauri/src/audio/transcription/engine.rs` | Inicializacion del motor de transcripcion |

**Gotchas de seguridad**:
- JWT tiene TTL de 5 minutos, se valida solo al conectar el WebSocket
- Conexiones activas sobreviven mas alla del TTL (validacion solo al inicio)
- Ambas conexiones WS (mic + system) usan el mismo JWT simultaneamente
- Reconexion despues de expirar el JWT (>5 min) fallara gracefully
- Usuario debe estar autenticado con Supabase (login con Google)

## Meeting Detector (Auto-Record)

Detecta Zoom, Teams y Google Meet en ejecucion. Puede auto-iniciar grabacion.

| Archivo | Descripcion |
|---------|-------------|
| `meeting_detector/detector.rs` | Logica principal de deteccion |
| `meeting_detector/process_monitor.rs` | Monitor de procesos activos |
| `meeting_detector/settings.rs` | Configuracion del detector |
| `meeting_detector/commands.rs` | Comandos Tauri |
| `components/meeting-detection/` | UI de dialogo y settings |

### Criterio de deteccion (rediseño anti-falsos-positivos, jul-2026)

El detector historicamente arrojaba un diálogo falso al dia sin abrir nada. Causa:
detectaba **procesos abiertos**, no reuniones, con reglas laxas. Reglas actuales:

1. **Match EXACTO del nombre de ejecutable** (`match_main_app` en `process_monitor.rs`),
   nunca `contains()`. Antes `"zoom"` suelto disparaba con `ZoomIt`, `"teams"` con
   `TeamsUpdate`, `"skype"` con `SkypeBackgroundHost`. **NO reintroducir subcadenas
   genericas** en `get_process_patterns()`.
2. **Dedup por app + flanco de subida**: se notifica UNA vez cuando la app pasa de
   ausente a presente, no una vez por PID. Antes cada worker que Teams/Zoom reciclaba
   en background nacia con un PID nuevo → deteccion nueva → falso diario.
   `ProcessMonitor` mantiene `apps_present` (tick anterior) + `last_notified` (cooldown).
3. **Cooldown por app**: `settings.notify_cooldown_minutes` (default 30). No re-notifica
   la misma app hasta que expira, aunque vuelva a haber flanco de subida.
4. **Gate de grabacion**: el loop del detector (`detector.rs`) hace `continue` si
   `audio::recording_phase::current_phase() != Idle`, ANTES de detectar (si detectara y
   descartara, la app quedaria marcada "presente" y no volveria a avisar tras grabar). El
   frontend (`MeetingDetectionDialog.tsx`) complementa suprimiendo tambien los estados
   UI-only que Rust no conoce (PROCESSING_TRANSCRIPTS/SAVING) con lista EXPLICITA, no `!== IDLE`.
5. **"Ignorar/Auto-grabar siempre" funcional**: `UserResponseAction::{IgnoreAlways,
   AutoRecordAlways}` llevan `app: MeetingApp`; `respond_to_meeting_detection` recibe
   `app: Option<MeetingApp>` del frontend y `handle_user_response` persiste via
   `set_app_action` + `save_settings`. `get_app_action` consulta `app_choices` primero.

> **Compatibilidad de settings**: `meeting_detector_settings.json` se lee de disco de
> versiones anteriores. Todo campo NUEVO en `MeetingDetectorSettings` DEBE llevar
> `#[serde(default = "...")]` — sin el, el parse falla y `initialize()` (que usa
> `.unwrap_or_default()`) resetea SILENCIOSAMENTE todas las preferencias del usuario.

> **Fuera de alcance (PR futuro)**: señal real de reunion via micro-en-uso
> (`CapabilityAccessManager` en Windows) y deteccion de Google Meet (hoy los
> `browser_patterns` son codigo muerto; requiere leer titulos de ventana del navegador).

## Sistema de Roles (Developer vs Usuario Regular)

- **Developers**: Emails con dominio `@asertio.mx` o `@maity.cloud` -> interfaz completa
- **Usuarios regulares**: Interfaz restringida (sin Gamificacion/Conversaciones en sidebar, settings limitados). NO estan forzados a Deepgram — transcriben con los motores locales igual que los developers.
- Archivos: `lib/roles.ts`, `hooks/useUserRole.ts`, `Sidebar/index.tsx`, `settings/page.tsx`, `ConfigContext.tsx`

## Restricciones Importantes

1. **Frecuencia de muestreo**: El pipeline espera 48kHz consistente. El remuestreo ocurre al momento de la captura.
2. **Audio por plataforma**: macOS requiere ScreenCaptureKit (13+) + permiso de screen recording. Windows WASAPI modo exclusivo puede conflictuar con otras apps.
3. **Grabacion stereo**: Se guarda como audio stereo entrelazado (L=mic, R=sistema). El `IncrementalAudioSaver` maneja checkpoints cada 30s con `channels=2`.
4. **Rutas de archivos**: Usar APIs de rutas de Tauri (`downloadDir`, etc.) para compatibilidad multiplataforma. Nunca hardcodear rutas.
5. **Permisos de audio**: macOS requiere tanto microfono COMO grabacion de pantalla para audio del sistema.

## Convenciones del Repositorio

- **Manejo de Errores**: Rust usa `anyhow::Result`, frontend usa try-catch con mensajes amigables
- **Nomenclatura audio**: Siempre "microphone" y "system" (no "input"/"output")
- **Ramas de Git**: se trabaja **directo en `main`**. NO crear ramas (`fix/*`, `enhance/*`, `feat/*`) por iniciativa propia — solo si el usuario lo pide explicitamente. El **push lo decide el usuario**: commit local, nada de `git push` sin que lo pida.
- **Commits**: Prefijos estandar (`feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`, `chore:`) con descripcion en espanol

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

**Nota sobre firma local**: El script `tauri-auto.js` maneja la ausencia de `TAURI_SIGNING_PRIVATE_KEY` en desarrollo local. Si la compilacion es exitosa pero falta la clave de firma, el script reporta un warning y sale con code 0 (comportamiento esperado).

**PROHIBIDO**:
- Usar `cargo build` como build final (solo compila Rust, no integra frontend)
- Hacer commit sin build exitoso (exit code 0)
- Reportar tarea completada sin build exitoso

**Artefactos debug**: `target/debug/maity-desktop.exe`, `target/debug/bundle/msi/Maity_*.msi`, `target/debug/bundle/nsis/Maity_*-setup.exe`

**Build de produccion** (solo para releases): `cd frontend && pnpm run tauri:build`

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
