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

> **Aviso de actualización bajo MSIX (ago-2026, #71):** el updater de GitHub sigue apagado bajo identidad de paquete (instalaría el `setup.exe` NSIS como segunda copia), pero ya **no** se calla: `updateService.checkForUpdates()` tiene rama `channel: 'store'` que compara `getVersion()` contra `maity.system_config['desktop_store_latest_version']` (`lib/storeChannel.ts`, comparación en `lib/versionCompare.ts`) y abre el `UpdateDialog` en variante Store — "Abrir la Store" (`ms-windows-store://downloadsandupdates` vía `open_external_url`, que no tiene allow-list de esquema) y "Cerrar Maity para actualizar" (`exit(0)` de `plugin-process`; se niega si `get_recording_state().is_recording`). **Nunca usar el `latest.json` de GitHub como referencia del canal Store**: va detrás (v0.2.52 vs 0.2.57). La fila se bumpea con SQL directo **solo al go-live** en Partner Center (el RPC `admin_update_system_config` tiene whitelist y no la acepta) — runbook en `.claude/skills/store-msix/SKILL.md` → "Go-live". Sin sesión Supabase el check devuelve "sin novedades" **sin armar el cooldown de 24 h**, porque `UpdateCheckProvider` vive fuera del `AuthGate` y el re-check de `visibilitychange` debe correr tras el login.

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
- **Dispositivos**: `list_audio_devices`, `switch_audio_device`, `poll_audio_device_events`, `get_active_audio_output` — la auto-reconexión reusa `switch_audio_device`: el frontend lo invoca al recibir `DeviceReconnected` del polling (los comandos `attempt_device_reconnect`/`get_reconnection_status` y el flag `is_reconnecting` fueron eliminados en ago-2026, eran código muerto)
- **Transcripcion**: `cancel_pending_transcription`, `recover_audio_from_checkpoints`, `cleanup_checkpoints`, `has_audio_checkpoints`
- **Whisper paralelo**: `initialize_parallel_processor`, `start_parallel_processing`, `pause/resume/stop_parallel_processing`, `get_parallel_processing_status`, `get_system_resources`
- **Deepgram proxy**: `fetch_deepgram_proxy_config`, `set/get/clear_deepgram_proxy_config`, `has_valid_deepgram_proxy_config`
- **Sync queue**: `sync_queue_enqueue`, `sync_queue_claim_job`, `sync_queue_complete_job`, `sync_queue_fail_job`, `sync_queue_get_all_statuses`, `sync_queue_cancel_meeting`, etc.
- **Meeting detector**: `start/stop_meeting_detector`, `is_meeting_detector_running`, `get_active_meetings`, `check_for_meetings_now`, `respond_to_meeting_detection`, `set_meeting_auto_record`, etc.
- **Notificaciones**: `send_native_notification` (transporte único, ver abajo), `native_notification_target` (diagnóstico), `get/set_notification_settings`, `show_notification`, DND status
- **Logging**: `get_log_info`, `export_logs`, `open_log_directory`, `clear_old_logs`
- **OAuth**: `start_oauth_server`, `get_pending_auth_code`, `get_pending_auth_tokens`
- **Sistema audio**: `start_system_audio_capture_command`, `list_system_audio_devices_command`, `check_system_audio_permissions_command`, `start/stop_system_audio_monitoring`

**Patron de estado**: Comandos Tauri actualizan estado Rust -> Emiten eventos -> Listeners del frontend actualizan estado React -> El contexto se propaga a los componentes.

### Notificaciones nativas: transporte propio, NO el plugin de Tauri (ago-2026)

> **`@tauri-apps/plugin-notification` es inutilizable bajo identidad de paquete (MSIX/Store).** Su `NotificationBuilder::show()` fija el `app_id` del toast a `config.identifier` (`com.maity.ai`) siempre que el exe no viva en `target\{debug,release}`. Eso baja a `CreateToastNotifierWithId(app_id)`: bajo MSIX el AUMID real es `Sixale.Maity_q5b9hqhck1xz0!Maity` y Windows **rechaza un AUMID ajeno**. El error se tragaba DOS veces — en Rust por el `let _ = notification.show()` dentro de un `spawn`, y en JS porque `sendNotification()` es **síncrona** y no devuelve la promesa del invoke. Síntoma: log en verde (`sendNotification RETURNED ok`), cero toast, y **ni siquiera** el fallback a toast in-app. Afectaba a TODAS las notificaciones de la Store ("Análisis listo", "Grabación lista/iniciada", recordatorio de pausa).

Hoy hay un **transporte único**: `src-tauri/src/notifications/toast.rs` → `show_native_toast()`, que llama a `tauri-winrt-notification` directo (la misma crate que el plugin usa por dentro) con el `app_id` resuelto **en runtime** por `resolve_target()`, y devuelve un `Result` real.

- **Frontend**: `lib/nativeNotification.ts` → `invoke('send_native_notification')`. Al ser comando propio **no pasa por el ACL de plugins**, así que también funciona desde las ventanas auxiliares (cuyas capabilities no traen `notification:default`). El `catch` ahora sí se dispara → fallback a toast in-app.
- **Rust**: `notifications/system.rs` enruta al mismo helper (arregla las notificaciones del lifecycle de grabación).
- **Orden de ramas de `resolve_target` (no invertir)**: (1) `is_running_under_package_identity()` → `utils::current_aumid()`; (2) dev/`target\{debug,release}` → `Toast::POWERSHELL_APP_ID`; (3) resto → `config.identifier` (NSIS). El check de identidad va **primero** porque `current_aumid()` devuelve un FALLBACK hardcodeado si la API falla, y ese literal en un proceso sin empaquetar reproduce el bug en espejo.
- **Los toasts SUENAN a propósito (ago-2026)**: `.sound(Some(Sound::Default))` emite cadena vacía (sin elemento `<audio>`) → Windows usa su sonido de notificación por defecto, en **ambos** canales. Es una decisión de producto, no un descuido. El valor previo era `.sound(None)`, que emite `<audio silent="true"/>` y replicaba el mudo histórico de notify-rust (que nunca setea `sound_name`). Para silenciar solo un tipo de notificación habría que pasarle el `NotificationType` a `show_native_toast` — hoy el sonido es uniforme. macOS sigue sin sonido explícito (usa el plugin).
- **`actionTypeId` está muerto en desktop y siempre lo estuvo**: el plugin solo registra `notify`/`request_permission`/`is_permission_granted` fuera de mobile — `registerActionTypes`/`onAction` rechazaban en silencio, así que el botón "Abrir Maity" nunca se renderizó. Se conserva en la firma para no tocar call sites. Click-para-abrir garantizado bajo MSIX exigiría un COM activator (`windows.toastNotificationActivation` + CLSID + `INotificationActivationCallback`) → tocar `Package.appxmanifest` + nueva submission.
- **Diagnóstico**: el `setup()` de `lib.rs` loguea `[toast] target resuelto: packaged=… mode=… app_id=…`, y Ajustes → Notificaciones tiene un botón **"Probar"** (`native_notification_target` + notificación de prueba). Es el único vector utilizable en un build release de la Store, que no trae devtools.

**Regla**: toda notificación nativa nueva pasa por `sendNativeNotification` / `show_native_toast`. Nunca `@tauri-apps/plugin-notification` ni `app.notification().builder()` directo — funcionan en NSIS y fallan mudos en la Store.

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

### Gate de Sesión (login compacto estilo Steam + coach-float + grabación) — ago-2026

Sin sesión la app NO graba por ninguna vía y NO muestra el coach-float; la ventana principal se compacta a un login de 480×640 (estilo Steam). Piezas (no revertir por separado — se diseñaron juntas):

- **Verdad de la sesión en Rust**: `state.rs::has_session(app)` lee `AppState.current_user_id` (lo llena `set_current_user` cuando `maityUser` carga en `AuthContext`; lo limpia `clear_current_user` al logout). Usa `try_state` por el orden de `manage` en first-launch.
- **Gate de grabación SOLO en entrypoints nativos**: `recording_lifecycle.rs::start_recording_with_meeting_name` (chokepoint de tray + scheduler) devuelve `Err` sin sesión; el tick del scheduler (`scheduled_recording/service.rs`, brazo `(false, Some(_))`) skipea con `SkipReason::NoSession` — al loguearse, el siguiente tick (≤30 s) arranca la jornada. Los paths de cierre/rotación NO llevan gate (un segmento owned debe poder cerrarse aunque muera la sesión). Los comandos `start_recording*` invocables por el frontend NO se gatean: viven detrás del AuthGate y gatearlos crea carrera con el IPC de `set_current_user` post-login.
- **Coach-float por sesión**: el auto-open ya NO vive en el `setup()` de lib.rs (el viejo spawn de 800 ms lo abría encima del LoginScreen). Vive en la transición None→Some de `set_current_user` → `coach::commands::open_coach_on_login` (respeta pref `coach_float_visible` y el override `STARTED_AT_BOOT`). `clear_current_user` cierra el coach. `open_floating_coach` tiene el check central (Ok silencioso sin sesión). El tray sin sesión enfoca el login en vez de grabar/togglear.
- **Login compacto**: comando `set_main_window_auth_layout(authenticated)` en lib.rs, idempotente vía `LOGIN_COMPACT_ACTIVE` (AtomicBool). El AuthGate lo invoca ANTES de emitir `app-ready` (ventana aún oculta → el primer `show()` sale ya con el tamaño correcto, sin flash) y en cada transición login/logout. Solo restaura 1100×700 si él mismo compactó: arrancar ya logueado es no-op y respeta el tamaño del usuario. Único flash posible: el fallback de 3 s de lib.rs si Next tarda >3 s en emitir `app-ready` (aceptado).
- **Logout**: `AuthContext.signOut` invoca `logout_cleanup` (reutiliza `graceful_shutdown_before_exit`, timeout 30 s) ANTES de limpiar estado local — detiene y GUARDA la grabación activa (jornada → persistencia nativa; manual → stop estándar) mientras `current_user_id` sigue vivo. Best-effort: nunca bloquea el logout.
- **Meeting detector**: sin cambios — solo emite eventos a la main; sin sesión no hay listeners montados (AuthGate).

> **Gate de registro (ago-2026, #66) — Rust es la autoridad, fail-closed.** El gate de `registration_form_completed` vivía SOLO en el render de la main (`layout.tsx`, `=== false`) y en producción un usuario con la UI parada en `/registration` grabó **21 jornadas** con 0.2.57: el scheduler, el tray y los floats (`/coach-float`, `/recording-widget` → `WIDGET_REQUEST_START_RECORDING` → `RecordingWidgetListener`, montado FUERA de la cadena de gates) nunca pasaban por ahí. Piezas, diseñadas juntas:
> - **Verdad en Rust**: `AppState.registration_completed: Option<bool>` (`None` = desconocido). `state::registration_completed(app)` es **fail-closed** (`None` → `false`). Gate en el mismo embudo que la sesión: `recording_helpers::initialize_recording` (cubre ambos start paths), `scheduled_recording` (`SkipReason::RegistrationIncomplete`, el tick siguiente arranca al completar) y `tray.rs`.
> - **Sincronización**: `useRegistrationGate` llama a `my_status` y espeja el valor con `set_registration_status(userId, completed)` (`registration_status.rs`). Lleva `userId` explícito para no depender del orden respecto a `set_current_user` (salen del mismo commit de React). Es la **única** fuente de `Some(false)`.
> - **Caché monótona local** (`registration-status.json`, solo ids con `true`): `set_current_user` siembra `Some(true)` si el usuario ya se vio completado en esa máquina → un usuario registrado que arranca **sin red** no queda bloqueado. Si la RPC falla, el hook cae a `get_registration_status`; solo un `true` cacheado pasa. Un `false` confirmado por la RPC retira el id (admin reseteó el flag).
> - **Frontend fail-closed**: `layout.tsx` usa `registrationFormCompleted !== true` (test AST en `layout.test.ts`); `false` → `/registration`, `null` con error → `RegistrationUnverified` ("No pudimos verificar…" + Reintentar; NO redirige al formulario: a un registrado sin red le pediría llenarlo otra vez). `RecordingWidgetListener` añade un guard UX con toast (misma query key, sin fetch extra); la autoridad sigue siendo Rust.
> - No "simplificar" volviendo a `=== false` ni quitando el gate del embudo "porque el layout ya lo tiene": ese fue exactamente el bug.

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
- **Provenance del sidecar (ago-2026):** `binaries/` está **gitignored** y nada lo construía en el build local — así se embarcaron 3 meses de helper stale (0.2.51-0.2.53, sin protocolo de ids → kill en cada timeout). Hoy el pre-build corre `frontend/scripts/verify-helper-binary.js`: compila `cargo build -p llama-helper --release` (cacheado; la primera vez compila llama.cpp, minutos) y **falla si el SHA-256 del bundleado no coincide**. Regenerar con `node scripts/verify-helper-binary.js --fix` (copia a `binaries/` y a `msix_staging/` si existe). Se salta en CI (los workflows compilan el sidecar con features de plataforma). El smoke post-build además le habla al helper bundleado (`{"type":"version","id":1}` → `{"type":"version","version":"0.1.1","protocol":2,"id":1}`); un helper viejo responde `error` sin id. **Al spawn**, `sidecar.rs` negocia capacidades con un ping correlacionado (`probe_capabilities`, 5 s, sin tocar el modelo) y loguea la versión del helper: `ids_confirmed` ya no se infiere del primer Generate; la ventana fría de 120 s la gobierna `model_warm` (primer Generate respondido), independiente de los ids.

### Verificación de email (signup desktop) — flujo cross-app

El signup con email/password (`signUpWithEmail`, `AuthContext.tsx`) manda `emailRedirectTo: 'https://www.maity.cloud/auth/confirm'`. El correo (armado por el Send Email Hook del repo web) trae un link a esa página con `?token_hash=...&type=signup` — **sin pasar por `/auth/v1/verify` de GoTrue** (issues web Sixale730/maity#135/#136). La página intenta abrir `maity://auth/confirm?token_hash=...&type=signup`:

- **Con app instalada**: el deep link llega a `handleDeepLinkCallback` (`AuthContext.tsx`), que hace `supabase.auth.verifyOtp({ token_hash, type: 'signup' })` → confirma la cuenta Y deja la sesión en el desktop. Cold start cubierto con `getCurrent()` del plugin deep-link al montar (single-instance solo reenvía a instancias ya vivas). El canal Store requiere el protocolo declarado en `frontend/Package.appxmanifest` (`<uap:Protocol Name="maity"/>` — bajo MSIX el `register()` en runtime queda virtualizado y no crea la asociación). El mismo handler procesa el **fallback del OAuth social** `maity://auth/callback` (cuando `start_oauth_server` no pudo hacer `bind` — p. ej. sandbox de App Store, que exige `com.apple.security.network.server` en `entitlements-appstore.plist`, #76): acepta `?code=` (PKCE, canjeado con `exchangeCodeForSession` — aquí SÍ es canjeable porque el `code_verifier` vive en este webview) y `?error=`, además del fragment `#access_token` legacy. Parsers puros con tests en `lib/authCallbackUrl.ts`. En macOS `register("maity")` no se llama (devuelve "unsupported platform"; el esquema va por `CFBundleURLTypes`) — #78.
- **Sin app (celular/otra PC)**: la página hace el `verifyOtp` en el navegador (fallback tras ~2.5 s sin blur) y muestra "cuenta verificada"; el desktop entra solo por el poll de `useAwaitEmailConfirmation.ts` (device-flow, issue #58).

Reglas: NO cambiar `emailRedirectTo` a localhost/deep-link (el correo se abre "casi siempre en el celular"); el token es de un solo uso — si `verifyOtp` falla pero ya hay sesión (el poll o la web ganaron la carrera), se ignora en silencio. El flujo PKCE `?code=` NUNCA es canjeable fuera del webview que inició el signup (el `code_verifier` vive ahí) — no intentar `exchangeCodeForSession` en otra superficie.

### Handoff de Pagos

- El desktop no tiene Stripe directamente; al elegir Pro, `useCreateCheckoutSession` construye la URL `https://www.maity.cloud/auth/handoff#access_token=...&next=/billing/plans?checkout=pro`
- `openExternalUrl` (via `lib/planLinks.ts`) abre el navegador externo del SO via `invoke('open_external_url')`
- Prerequisito: la web debe desplegar `/auth/handoff` (issue Sixale730/maity#133)
- Enterprise/anual → `/agenda` interceptado en router-compat (sin patch adicional)
- **CTA "Ver planes" dentro de la app → ruta interna `/billing/plans`, NO `PRICING_URL`.** `https://www.maity.cloud/pricing` es la landing de anónimos: a un usuario con sesión activa en el navegador lo redirige fuera. Como `layout.tsx` excluye el Sidebar en `/billing/plans`, esa página lleva un botón "Volver" (`router.back()`) que solo se pinta si `window.history.length > 1` — sin él, entrar desde dentro de la app deja al usuario atrapado; con la condición, no aparece un botón muerto en el gate de registro (que entra ahí en frío).

### Recuperar el análisis de una conversación en `quota_skipped` — ago-2026

Desde el issue web #138, `quota_skipped` **dejó de ser un estado sin salida**: tras un upgrade el dueño puede recuperar el V4 desde el detalle de la conversación (botón "Analizar ahora" junto a "Ver planes").

Camino: `ConversationDetail.tsx` → `retryAnalysisCloud` (`conversations.service.ts`) → comando `retry_analysis_cloud` (`src-tauri/src/api/retry_analysis.rs`) → `POST /api/conversations { action: 'retry_analysis', conversation_id }`.

- **NO colgar este botón de `reanalyzeMutation` / `reanalyzeConversation`.** Ese camino llama a `action: 'finalize'`, que re-despacha **también la minuta** (pisando una que el usuario pudo regenerar a mano) y no pasa por `decideRetryPlan`, la política del servidor que decide qué despachar y **cobra la unidad** al recuperar desde `quota_skipped`. Por eso son dos mutaciones separadas.
- **El botón se pinta siempre y el 403 se maneja** — no se consulta la cuota antes. Contrato del endpoint: **202** `{status:'processing'}` (despachado, cobra 1 unidad, solo `communication`), **403** `QUOTA_EXCEEDED` si el plan sigue agotado, **200** `{skipped:"not retryable from status=..."}` si la fila ya está `completed`/`skipped`.
- **`quota_skipped` sigue siendo terminal en `derivePhase`** y `AnalysisStatusBanner` lo sigue silenciando — es el estado de reposo correcto. Lo que reanuda el polling es el `onMutate` que escribe `analysis_status:'processing'` optimistamente en la caché: `refetchInterval` de `useConversationLive` es una **función**, TanStack la re-evalúa tras cada escritura y un row no-terminal devuelve el piso de 3 s. Si el retry termina en 403, el refetch devuelve la fila a `quota_skipped` y el polling se apaga solo.
- **El 403 de cuota se detecta por el campo `error`, no `code`.** `ApiError.send()` de la web responde `{ error: 'QUOTA_EXCEEDED', message, details }`; hasta ago-2026 `finalize.rs` leía `code` (inexistente) y clasificaba TODO 403 de cuota como problema de ownership → el usuario veía "No tienes permiso para analizar esta conversación". El parseo vive ahora en un único helper `api::finalize::parse_quota_403` (con tests), compartido por `finalize.rs` y `retry_analysis.rs`; debe seguir devolviendo el payload con prefijo `quota:` porque es el contrato que leen `parseQuotaError` (`lib/quotaErrors.ts`) y `quota_period` (`cloud_sync/worker.rs`).

### Guardado de archivos generados (.md / .pdf / .pptx) — ago-2026

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

**Componentes globales en layout**: `SplashScreen`, `AuthGate`, `ChunkErrorRecovery`, `ErrorBoundary`, `ErrorTelemetryInitializer`, `MeetingDetectionDialog`, `OfflineIndicator`, `CloudSyncInitializer`, `HealthHeartbeatInitializer`, `GlobalConversationNotifier`, `DbInitErrorGate`

> **Ventanas auxiliares** (`/coach-float`, `/recording-widget`, `/device-picker`): `RootLayout` hace early-return ANTES de montar todos esos componentes. La lista canónica de rutas vive en `lib/auxWindows.ts` (`isAuxWindowPath`) — no duplicarla inline. `CloudSyncInitializer`, `GlobalConversationNotifier` y `HealthHeartbeatInitializer` llevan además su propio gate `isAux` como defensa en profundidad (patrón: el efecto depende del booleano `isAux`, NO de `pathname`, para no reiniciarse en cada navegación).

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
| `useUserRole` | Rol de usuario (`admin`/`manager`/`user`) desde la DB, fail-closed |
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
| `roles.ts` | `getUserRoleFromRPC()`, `isAdmin()`, `isManager()`, tipo `UserRole` |
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
- `analysis/dashboard-v1/` — el dashboard de análisis real (hero, `TuRadarCard`/`RadarCalidad` con Chart.js, KPI, insights, hallazgos, recomendaciones, `adapter.ts` cloud V4 → shape V1). `analysis/index.ts` solo exporta `TranscriptSection`; los 10 componentes legacy de `analysis/` y los charts huérfanos (`charts/` solo conserva `GaugeChart`, usado por `minuta/MinutaGauge`) se borraron en ago-2026 (#74).
- `AnalysisSkippedCard.tsx` — tarjeta del análisis omitido (ramifica por `reason`); `InputQualityNotice.tsx` — aviso "se analizaron X de Y min" (`calidad_insumo`); `AnalysisStatusBanner.tsx` — polling/stalled/failed
- `minuta/` — 7 componentes de minuta de reunion (acciones, decisiones, seguimiento, efectividad)
- `useAnalysisPolling.ts` — Hook de polling con fases: idle -> polling -> retrying -> completed

> **Rúbrica 6.x del V4 en el desktop (ago-2026, #72-#74).** La web cambió el contrato del JSONB `communication_feedback_v4` el 21-ago-2026 (Sixale730/maity #142/#147). Reglas espejo, todas deliberadas:
> 1. **"Tiene análisis" = `isFullAnalysis(v4)`, nunca truthiness.** El marcador skipped (`{status:'skipped', reason, user_words, min_required, speakers, metrics}`) es un objeto truthy: con `v4 &&` una grabación omitida lucía el badge "Análisis" en la lista y dejaba `isAnalyzing` pegado en `app/conversations/page.tsx`. Skipped es terminal (`derivePhase`). Los fallos de proveedor NO usan el marcador: escriben `null` + `analysis_status='failed'`.
> 2. **La tarjeta skipped ramifica por `reason` y no inventa cifras** (`AnalysisSkippedCard`): `insufficient_user_words` ("no dijiste `min_required` palabras", sin default — el `?? 15` viejo estaba obsoleto, el umbral es 100) vs `no_evaluable_speech` (#147: "grabaste 60 min pero en ningún tramo de 5 min hubo conversación continua" — el bloque de jornada; en el piloto fue ~1 de cada 4 grabaciones). Reason desconocido → texto genérico. Ninguno consume cuota; la minuta sí se genera.
> 3. **Todo agregado de puntajes pasa por `utils/scoring.ts::getCommScore`**, que devuelve `null` para skipped Y para `calidad_insumo.nivel === 'baja'` (`isLowConfidenceV4`: ruido transcrito o atribución de hablantes adivinada). Mismo predicado que `maity.team_conversation_scores` y `getNormalizedScores` de la web; NULL-safe para filas anteriores a #147. El detalle sí muestra el puntaje `baja`, con aviso ámbar (`InputQualityNotice`, leído del raw con `readCalidadInsumo` — el adapter no conserva `calidad_insumo`).
> 4. **Un componente `null` o listado en `dimensiones_no_aplica` NUNCA se pinta como 0.** `dashboard-v1/adapter.ts` lo traduce a `calidad_global.no_aplica` (fuentes, en orden: `dimensiones_no_aplica` → `recording_mode==='presentation'` para filas pre ago-2026 → `componentes[k] === null`), `RadarCalidad` omite el eje y `TuRadarCard` explica la nota. `componentes` sigue numérico (0) para no romper KPI/Hallazgos. Tests: `adapter.test.ts`, `scoring.test.ts`, `AnalysisSkippedCard.test.tsx`, `InputQualityNotice.test.tsx`.
> 5. `getOmiStats`/`OmiStats` se borraron: leían `resumen.puntuacion_global` y dimensiones (`emociones`, `formalidad`, `muletillas`) que 6.x no escribe. `DashboardV1Preview.tsx` (ruta admin `/dev/dashboard-v1`) sigue con niveles viejos a propósito: es fixture, no contrato.

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

### Recuperación de grabaciones interrumpidas — automática y sin fantasmas (ago-2026)

Cada grabación crea al **arrancar** un registro en IndexedDB (`TranscriptContext`, `recording-started`, `transcriptCount:0, savedToSQLite:false`) que sirve de WAL para transcripts; al guardar se marca `savedToSQLite=true`. `useTranscriptRecovery` + `app/page.tsx` lo consumen en el arranque:

- **Filtro de fantasmas**: un registro sin marcar con `transcriptCount === 0` (aborto temprano, segmento de jornada en silencio — `finalize_segment_native` devuelve `None` y el frontend no lo marca —, STT que nunca cargó) **se borra de IndexedDB** y no se ofrece. Decisión de producto: sin transcripts NO se recupera como reunión, **aunque haya checkpoints de audio**. El filtro **nunca** toca disco (`cleanup_checkpoints`/carpeta).
- **Auto-recuperación**: las candidatas con transcripts se guardan solas (`autoRecoverAll`, en serie: cada una lanza FFmpeg + escribe SQLite) y sale **un** toast ("Reunión recuperada" con "Ver" / "Se recuperaron N…"). Sin auto-navegación. El diálogo `TranscriptRecovery` queda solo como **red de seguridad** para las que fallan; `page.tsx` lo gatea con `autoRecoveryDone` porque `checkForRecoverableTranscripts` llena `recoverableMeetings` ANTES de que la auto-recuperación las vacíe.
- El arranque se gatea con `useAuth().maityUser?.id` (no `[]`): `api_save_transcript` exige `current_user_id` en Rust y ese IPC lo dispara `AuthContext` al cargar `maityUser`. Si aun así llega `no user logged in`, `isTransientNoUserError` lo trata como transitorio: se saca de la lista sin marcar → reintento en el próximo arranque, sin diálogo.
- **`useRecordingStop` con 0 transcripts**: ya NO deja el registro sin marcar "para el diálogo" (era un callejón sin salida: `recoverMeeting` rechaza reuniones sin transcripts). Si hay checkpoints, fusiona best-effort con `recover_audio_from_checkpoints` (deja `audio.mp4` en la carpeta), marca guardada, y avisa con toast "Reunión sin transcripción" + acción **"Abrir carpeta"** (`reveal_in_folder`). Los eventos de telemetría `save_deferred_audio_only`/`save_skipped_no_transcripts` se conservan tal cual (catálogo).
- Pendiente conocido: la carrera de `markMeetingAsSaved` en rotación de jornada (`TranscriptContext` resuelve el id por `sessionStorage`, que el nuevo segmento pisa) puede dejar un segmento con transcripts sin marcar → se auto-recupera como reunión local (posible duplicado del que Rust ya guardó).

Tests: `hooks/useTranscriptRecovery.test.ts`, `hooks/useRecordingStop.feedback.test.tsx` (bloque "0 transcripts con audio en disco").

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

## Telemetria y diagnostico remoto

Inventario completo en **`docs/TELEMETRIA.md`**: pirámide de 3 niveles — (1) `health.heartbeat` (RAM por proceso vía `get_health_snapshot`, cada 5 min activo / 15 min idle) y eventos a Supabase `maity.platform_logs` vía `platformLogger`; (2) `app.error` con rate-limit (handlers globales + ErrorBoundary, `lib/errorTelemetry.ts`); (3) logs completos SOLO locales (`[METRIC] mem-sample` cada 30s + export ZIP manual). Los logs crudos NO van a la nube (volumen/privacidad — decisión jul-2026). El doc incluye las queries SQL de análisis y el runbook de fugas de RAM.

**Bundle de incidente con consentimiento (ago-2026, #61):** la ÚNICA vía por la que un log sale de la máquina es `upload_incident_bundle` (`logging/incident.rs`), y SOLO tras el "Enviar" del usuario en `IncidentReportDialog` (umbral de RAM sostenido, panic del arranque anterior, o botón manual en Ajustes). Nunca automático, sin reintentos, ~200 KB de tail + cabecera + system_info a Storage `incident-bundles/{auth_uid}/`. Detalle, triggers y cooldowns en `docs/TELEMETRIA.md` → Nivel 3. El bucket lo crea la web (`docs/incident-bundles-bucket.sql`); mientras no exista, el envío falla con mensaje corto.

**El doc es contrato ejecutable (ago-2026):** evento nuevo = 3 entradas — `lib/telemetry-events.ts` + `logging/telemetry/catalog.rs` + fila en el doc — verificadas por `scripts/lint-telemetry.js` en el pre-build (single writer de `insert_platform_log`, catálogo espejo con marcador `legacy`, naming dot-namespaced, sin `'unknown'` en versiones, `core:app:default` en toda capability). `scripts/lint-tauri-acl.js` cruza además los call sites que exigen permiso (`onCloseRequested` ⇒ `allow-destroy`, `confirm`/`alert`, `getVersion`) contra las capabilities POR VENTANA (reachability de imports desde `app/<aux>/page.tsx`). Escapes: `// telemetry-allow:` / `// acl-allow:`.

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
├── tauri.macos.conf.json        # Overrides para macOS (merge automatico): externalBin = llama-helper + ffmpeg
├── tauri.appstore.conf.json     # Overrides del canal Mac App Store (se aplica ENCIMA del de macOS via --config)
├── entitlements.plist           # Entitlements para desarrollo/distribucion directa
├── entitlements-appstore.plist  # Entitlements para App Store (sandbox)
├── entitlements-appstore-inherit.plist  # Solo app-sandbox + inherit: para los sidecars (llama-helper, ffmpeg)
└── Info.plist                   # Permisos macOS (NUNCA eliminar las *UsageDescription) + ITSAppUsesNonExemptEncryption=false
```

> **ffmpeg en macOS viaja DENTRO del bundle (ago-2026, #77).** `audio/ffmpeg.rs` lo descargaba en runtime (evermeet.cx/osxexperts.net → `~/.local/bin`, escribiendo además en `.zshrc`); bajo el sandbox de la Mac App Store eso no puede escribirse y ejecutar un binario descargado viola la guideline 2.5.2 → sin `audio.mp4` al terminar de grabar (rechazo 2.1). Hoy `frontend/scripts/build-ffmpeg-macos.sh` (lo corre `run-pre-build-checks.js` en macOS y `build-macos.yml` en CI) **compila desde la fuente oficial, pineada por SHA-256, un ffmpeg mínimo y LGPL** (`--disable-gpl --disable-nonfree`, solo lo que usan `encode.rs` e `incremental_saver.rs`: `f32le→aac/mp4` y `concat -c copy`; ~5-10 MB por slice, sin nasm) y lo deja como `binaries/ffmpeg-{aarch64,x86_64,universal}-apple-darwin`. Entra por `bundle.externalBin` de `tauri.macos.conf.json` → `Contents/MacOS/ffmpeg` en **ambos** canales macOS. Reglas: (a) **nunca `bundle.resources`** — `package-appstore.sh` solo firma con `inherit` los ejecutables de `Contents/MacOS`, y Apple no quiere código en `Resources`; (b) `find_ffmpeg_path` en macOS mira **primero** junto al ejecutable (antes que PATH), así que la descarga en runtime queda inalcanzable en macOS — no borrarla: Windows/Linux siguen usándola; (c) los binarios prehechos de terceros son GPL (libx264…) e incompatibles con los términos de la App Store — no sustituir el script por una descarga; (d) aviso de licencia en Ajustes → Acerca de y en `docs/THIRD-PARTY-NOTICES.md` (mantener en sync si cambia la receta). Windows no cambia (el MSIX copia `ffmpeg.exe` a mano, ver `store-msix`).

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

## Cliente Supabase: el default es `public`, y todo call site dice su schema (ago-2026)

`frontend/src/lib/supabase.ts` crea el cliente con **`db: { schema: 'public' }`**. Antes era `'maity'` (desde `230b807`, feb-2026) y eso puso **5 RPC del desktop en 403** cuando el hardening de la DB (issue web #143) cerró el schema `maity` a los roles de cliente: `authenticated` solo puede ejecutar `maity.submit_chat_bug_report`. Issue #70.

**Lo grave no fue el 403, fue que ninguno se vio.** `insert_platform_log` tenía un `catch {}` vacío que ni siquiera inspeccionaba `.error`; `calculate_user_streak`/`get_my_xp_summary` caían a **cero** (indistinguible de cuenta nueva); `insert_user_feedback` solo hacía `console.warn`; y `get_user_role` devolvía `null` → el heurístico por dominio de email, o sea **un `manager` fuera de `@asertio.mx`/`@maity.cloud` se degradaba a `user` en silencio**. Meses en producción sin una sola señal.

Reglas, todas deliberadas:

- **`public` es el perímetro mediado.** Los clientes entran por wrappers `public.*` (SECURITY DEFINER); ahí vive la autorización. `calculate_user_streak` es el caso testigo: **nunca** se va a conceder `maity.calculate_user_streak` a `authenticated`, porque el gate está en el wrapper `public` (migración `20260814000000` de la web) — la interna la llaman el dashboard de equipo, el leaderboard y `award_xp_for_session` sobre ids de OTROS usuarios vía `LATERAL`, y un gate adentro rompería al manager.
- **Las TABLAS de `maity` no se tocaron** — siguen accesibles vía RLS y se piden con **`.schema('maity')` explícito**. Nunca por el default. Los 16 `.from()` que dependían de él (conversaciones, `users` de `AuthContext`, `form_responses`, diagnostics) ya están explícitos.
- **Dos guardias, porque los dos modos de falla no son simétricos.** Un `.rpc()` mal ruteado da **403 silencioso**; un `.from()` mal ruteado da `PGRST205`, que es ruidoso. La regla `no-restricted-syntax` de `frontend/.eslintrc.json` cubre `.rpc()` pelón (error, con el fix en el mensaje); el test `frontend/src/lib/supabase.test.ts` cubre **además** `.from()`, parseando todo `src/` con el TS Compiler API (mismo patrón que `app/layout.test.ts`) y verificando que el default del cliente siga siendo `public`. Ambos se verificaron rompiéndolos a propósito.
- **`src/shared/maity-shared/**` está exento del lint**: es el árbol copiado zero-drift de `Sixale730/maity` y sus `.rpc()` pelones son correctos ahora que el default es `public`. Su `api/client/supabase.ts` era un Proxy que forzaba `.schema('public')`; quedó en no-op y se adelgazó a un **re-export**. El archivo se conserva (es el seam de import del árbol copiado), la lógica no.
- **El mock de tests `src/test/mocks/supabase.ts` es schema-aware.** Su `.schema()` era `vi.fn(function () { return this })` — un passthrough que tiraba el schema pedido, así que **ningún test podía detectar una regresión de ruteo**. Hoy `.schema(x)` devuelve una superficie nueva y registra cada llamada (`schemaCalls`, `schemaOf(name)`). No volver a "simplificarlo".
- **Realtime es independiente**: `GlobalConversationNotifier.tsx` hardcodea `schema: 'maity'` en el filtro `postgres_changes`. Realtime no lee `db.schema` — está bien así, no tocarlo.

## Deepgram via Cloudflare Worker Proxy

La transcripcion en la nube usa Deepgram a traves de un Cloudflare Worker proxy. **La API key de Deepgram nunca llega al cliente**.

> **Sin edge functions de Supabase en este repo (ago-2026, #67).** Existían `deepgram-token` y `deepseek-evaluate` en `supabase/functions/`; eran código muerto (cero call sites en desktop/web/móvil, cero tráfico en el gateway) y las versiones desplegadas —subidas por dashboard, divergentes del repo— devolvían la `DEEPGRAM_API_KEY` cruda a cualquier JWT válido. Se borraron del repo y del proyecto `nhlrtflkxoojvhbyocet` (vía Management API con el PAT del `.mcp.json`; el MCP no tiene delete ni secrets), junto con los secrets `DEEPGRAM_API_KEY`/`DEEPSEEK_API_KEY`; la rotación de keys (Deepgram en Worker + móvil, DeepSeek) es housekeeping operativo (runbook en el issue). **No recrear `supabase/` ni re-desplegarlas**: el token de Deepgram lo emite Vercel `/api/deepgram-token` (JWT de 5 min) y el Worker `maity-deepgram-proxy` es el único que conoce la key; el análisis va por Vercel `conversations-finalize` (`api/finalize.rs`). Una función Supabase nueva vive en el repo web, con gate server-side (`maity.fn_check_quota`/rol, nunca `users.status`). La regla `no-restricted-syntax` de `frontend/.eslintrc.json` bloquea `supabase.functions.invoke(` en `frontend/src`.

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

## Meeting Detector (Auto-Record) — DESHABILITADO por kill-switch (ago-2026)

> **Estado actual: APAGADO.** Aun con el rediseño anti-falsos-positivos de jul-2026 seguía disparando diálogos que no correspondían a reuniones reales, así que se apagó por completo con `meeting_detector::DETECTOR_KILL_SWITCH = true` (`src-tauri/src/meeting_detector/mod.rs`). El único choke point es `MeetingDetector::start()` (por ahí pasan el auto-start del `setup()` de `lib.rs` y el comando `start_meeting_detector`): con el flag activo retorna `Ok(())` sin arrancar el loop, y `is_meeting_detector_running` devuelve `false`. Es **independiente de `settings.enabled`** (el JSON en disco de usuarios existentes trae `enabled: true` y pisaría un cambio de default; `test_default_settings` sigue afirmando `true`). `<MeetingDetectionDialog />` ya **no se monta** en `app/layout.tsx` (el componente sigue en `components/meeting-detection/`); el listener de `start-recording-from-detector` en `useRecordingStart.ts` queda inerte. **NO borrar el módulo**: `scheduled_recording/service.rs` reutiliza su `ProcessMonitor`. Para reactivar: flag a `false` + volver a montar el diálogo. La pestaña "Reuniones" de `components/settings/SettingTabs.tsx` es código muerto (nadie importa `SettingTabs`; el settings real es `app/settings/page.tsx`).

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

## Sistema de Roles: `admin` / `manager` / `user`, siempre desde la DB (ago-2026)

El rol lo decide **la base de datos**, nunca el dominio del correo. `lib/roles.ts` → `getUserRoleFromRPC()` llama a `public.get_user_role` (wrapper SECURITY DEFINER; la version `maity.*` no esta concedida a `authenticated` — ver la seccion del cliente Supabase). El enum en la DB es exactamente `admin|manager|user` y el trigger `maity_users_ensure_role` le pone `'user'` a toda alta nueva, asi que **un NULL de esa RPC ya es una anomalia real**, no el caso normal.

**`useUserRole` es fail-closed (issue #68).** Hasta ago-2026 hacia `rpcRole ?? getUserRoleFromEmail(email)`, o sea que **cualquier** fallo de la RPC repartia UI de admin a `@asertio.mx`/`@maity.cloud` y degradaba en silencio a todos los demas. No era teorico: #70 dejo esa misma RPC en 403 desde el 13-ago 05:00 UTC, asi que el fallback fue el **camino principal** de todo el desktop, no la excepcion.

Reglas, todas deliberadas:

- **`ADMIN_DOMAINS` y `getUserRoleFromEmail` se eliminaron por completo**, no se "invirtieron a `user`". Contrastado contra produccion, el heuristico estaba mal para **8 de 249 usuarios**: 2 admins y 4 managers de dominio externo (los degradaba a `user`) y 2 cuentas internas que NO son admin (les regalaba `admin`). Hay un test que falla si alguien vuelve a exportarlos.
- **`role` es `UserRole | null`**: `null` = **desconocido**, jamas "es user". `roleKnown` los distingue. `isAdmin` es `false` mientras carga **y** si la RPC falla. El intercambio es a proposito: un fallo ahora **esconde** UI de admin en vez de regalarla.
- **`ConfigContext` NO actua con el rol desconocido.** Su migracion a Parakeet **persiste** (`invoke('api_save_transcript_config')`), asi que forzar sin saber el rol le pisaria la configuracion a un admin de forma permanente. La rama de estado estable esta gateada con `roleKnown && !isAdmin`; la migracion one-time no depende del rol y corre igual.
- **El reset de pestaña en `settings/page.tsx` va gateado con `!roleLoading`** — si no, un admin que entre por deep-link a una pestaña de admin sale expulsado a General antes de que resuelva la RPC.
- **Los fallos se loguean con `fileLogger`, no con `platformLogger`**: este ultimo es *el mismo* una RPC de Supabase, asi que si `get_user_role` falla por sesion/RLS/403, `insert_platform_log` falla por lo mismo y la señal se pierde justo cuando importa.
- **Dedupe de la RPC in-flight** en `useUserRole` (llaveado por email): hay tres consumidores y cada uno monta su propio efecto. Colapsa llamadas concurrentes, **no** cachea el resultado — un fallo transitorio no debe quedar pegado toda la sesion.

**Alcance: visibilidad de UI, no acceso a datos.** Del lado servidor manda RLS. Consumidores reales: `settings/page.tsx` (pestañas Transcripcion/Resumen/Pipeline + badge Admin + boton de preview), `components/transcript/TranscriptSettings.tsx` (opcion Canary) y `contexts/ConfigContext.tsx`. La ruta `app/dev/dashboard-v1/page.tsx` **no tiene guard propio**: el gate vive solo en el boton que enlaza.

> **El Sidebar NO filtra nada por rol.** `components/Sidebar/index.tsx` no importa `useUserRole` ni `roles.ts`; pinta Inicio/Conversaciones/Notas/Tareas/Chat para todos, y Gamificacion ni siquiera aparece ahi (vive embebida en `app/page.tsx`). Este documento afirmaba lo contrario hasta ago-2026.

- Archivos: `lib/roles.ts`, `hooks/useUserRole.ts`, `settings/page.tsx`, `components/transcript/TranscriptSettings.tsx`, `ConfigContext.tsx`
- Pendiente: espejar el arreglo en el repo movil (mismo bug con la misma lista de dominios).

> **Codigo muerto eliminado en el mismo cambio:** `AuthContext` insertaba en `maity.users` desde el cliente. Esa tabla **no tiene ninguna policy de INSERT** (verificado: 3 de SELECT y 1 de UPDATE), asi que siempre fallaba con `42501` — el alta funciona por el trigger `on_auth_user_created`, no por ese insert. Con el se fue `TRUSTED_DOMAINS`, una **tercera** copia de la lista de dominios que decidia `ACTIVE` vs `PENDING_APPROVAL`, y la rama de refetch tras `23505`, que solo existia para una carrera de ese insert imposible. La rama `PGRST116` pasa a reintento acotado (3 intentos, 300/600/1200 ms): si la fila no esta, solo puede ser timing del trigger.

## Restricciones Importantes

1. **Frecuencia de muestreo**: El pipeline espera 48kHz consistente. El remuestreo ocurre al momento de la captura.
2. **Audio por plataforma**: macOS requiere ScreenCaptureKit (13+) + permiso de screen recording. Windows WASAPI modo exclusivo puede conflictuar con otras apps.
3. **Grabacion stereo**: Se guarda como audio stereo entrelazado (L=mic, R=sistema). El `IncrementalAudioSaver` maneja checkpoints cada 30s con `channels=2`.
4. **Rutas de archivos**: Usar APIs de rutas de Tauri (`downloadDir`, etc.) para compatibilidad multiplataforma. Nunca hardcodear rutas.
5. **Permisos de audio**: macOS requiere tanto microfono COMO grabacion de pantalla para audio del sistema.

## Convenciones del Repositorio

- **Manejo de Errores**: Rust usa `anyhow::Result`, frontend usa try-catch con mensajes amigables
- **Nomenclatura audio**: Siempre "microphone" y "system" (no "input"/"output")
- **Identificador de dispositivo de audio**: el formato canónico es el nombre CRUDO tal como lo enumera el OS (`get_audio_devices`), SIN sufijo `(input)/(output)`. Es el formato que aceptan `switch_audio_device`, `start_audio_level_monitoring` y `start_recording_with_devices_and_meeting`. NO volver a concatenar sufijos en la UI (helper: `lib/deviceName.ts` → `stripDeviceTypeSuffix`, aplicado al hidratar `ConfigContext`). En Rust, `AudioDevice::from_name_with_default_type(name, tipo)` acepta el legacy con sufijo por compat; el tipo lo aporta el contexto del caller (path mic → Input, path system → Output). Antes convivían dos formatos y el crudo caía en fallback silencioso al default.
- **Claves de `invoke()` en camelCase**: los comandos Tauri sin `rename_all` esperan camelCase (`micDeviceName`, no `mic_device_name`). Con snake_case las claves no matchean y los `Option<String>` llegan como `None` SIN error — así se rompió `start_recording_with_devices_and_meeting` durante meses (dispositivo elegido, título de reunión y Modo Ponente nunca llegaban al backend; jul-2026). El preflight `resolve_actual_endpoint` (`recording_helpers.rs`) además verifica qué endpoint abrirá WASAPI de verdad y adopta su nombre real (el fallback de `get_windows_device` devuelve `Ok` con OTRO dispositivo sin avisar).
- **Persistencia de la selección de dispositivos**: `ConfigContext.updateSelectedDevices` es el setter canónico — actualiza el estado Y persiste en `recording_preferences.json` (read-merge-write serializado; `set_recording_preferences` reemplaza el objeto ENTERO, no mergea). Lo usan la píldora (`page.tsx`), `SettingsModal` y `RecordingWidgetListener`. El setter crudo `setSelectedDevices` queda solo para la hidratación y para `RecordingSettings` (que ya persiste por su cuenta — usar el canónico ahí duplicaría la escritura). NO volver a cablear escritores nuevos al setter crudo: es como la selección se perdía al reiniciar (ago-2026).
- **Matcher de nombres (`device_name_matcher.rs`)**: `normalize` elimina el índice Bluetooth de Windows `"(N- ...)"` (sube en cada re-emparejamiento) además del sufijo re-plug `"(N)"`. El `device_monitor` matchea con `is_same_device` (NO igualdad exacta) y emite `DeviceReconnected` con el nombre RE-ENUMERADO, adoptándolo como nuevo nombre vigilado.
- **Watchdog de silencio de mic** (`recording_helpers.rs`, dentro de la task de niveles de 100 ms): detecta grabación muda que WASAPI no reporta como error (mute por hardware, cambio de perfil BT A2DP↔HFP). Dos modos: "stalled" (el contador `RecordingState::mic_chunk_seq` no avanza 10 s → el RMS atómico está stale y se ignora) y "silent" (chunks con RMS < 1e-5 sostenido 15 s — el noise floor de un mic vivo nunca baja de ~1e-4, las pausas de conversación no disparan). Emite `mic-silence-warning` (latch: 1 por episodio, rearma al volver audio audible; toast en `useMicrophoneFallbackToast`). En pausa se resetea sin alertar. Todo evento nuevo Rust↔TS exige entrada gemela en `events.rs` + `lib/tauri-events.ts` (lint pre-build).
- **Guardia de perfil Bluetooth** (`audio/bluetooth_guard.rs`, ago-2026): Bluetooth clásico no permite A2DP (estéreo) y HFP (mono 16 kHz, con mic) a la vez — abrir el endpoint de CAPTURA de unos audífonos conmuta TODO el dispositivo a manos libres y degrada la música del usuario. Pasaba en dos momentos: grabando (la jornada graba del mic del headset horas) y **en reposo** (el preview de niveles lo abría sólo para animar las barritas). Hoy: (a) al arrancar grabación, `apply_bluetooth_output_mic_override` sustituye el mic BT por uno no-BT y emite `bluetooth-mic-avoided` (toast); (b) el preview no abre micrófonos BT (`should_avoid_opening_mic`), y la UI atenúa las barras con tooltip. Reglas: la detección es **NATIVA** (`PKEY_Device_EnumeratorName` → `BTHENUM`/`BTHHFENUM`/`BTHLEENUM`), **nunca por nombre** — `device_detection.rs` no matchea dispositivos renombrados (falso negativo) y `device_monitor.rs` matchea "auriculares", genérico en Windows en español (falso positivo). Leer el property store **NO** activa el `IAudioClient`: no sustituir por `Activate()`/`default_input_config()` sobre el endpoint BT o se dispara justo lo que se evita. Sólo se sustituye con A2DP vivo (mix rate ≥32 kHz): si ya está en 16 kHz otra app lo conmutó y el mic de diadema capta mejor. El sustituto excluye loopbacks y cables virtuales (grabar "Mezcla estéreo" = horas sin voz). No persiste nada: la preferencia del usuario queda intacta y `switch_audio_device` no lleva override (es el escape hatch). El preview del SISTEMA (loopback) nunca se apaga: es captura del lado render y no toca el micrófono.
- **Registro de owners del level monitor** (`simple_level_monitor.rs`): `start/stop_audio_level_monitoring` llevan `ownerId` y `wantMic`. Reemplazó a un refcount que se corrompía porque start y stop son comandos Tauri **concurrentes**: el cleanup de React disparaba `stop` sin esperar al `start` en vuelo, el stop veía 0 y hacía no-op, y el start dejaba el **micrófono abierto para siempre sin consumidor que lo cerrara**. Ahora un `stop` sin `start` previo deja un *tombstone* que el `start` consume sin abrir nada. `usePreviewLevels` genera el `ownerId` **por corrida del efecto** (no por instancia: al cambiar de device conviven dos corridas) y encadena el stop a la promesa del start. El hide-to-tray usa `force_stop_all()`, no `stop_monitoring(owner)` — no es un consumidor pareado y le robaría el slot a otro.
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
