# CLAUDE.md

Este archivo proporciona orientacion a Claude Code al trabajar con este repositorio.

## Descripcion del Proyecto

**Meetily (Maity Desktop)** es un asistente de reuniones con IA enfocado en privacidad que captura, transcribe y resume reuniones localmente. Dos componentes principales:

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
Build firmado de produccion con bump automatico de version semver. Lee signing keys de `frontend/.env`, actualiza la version en 3 archivos (`tauri.conf.json`, `package.json`, `Cargo.toml`), y ejecuta `pnpm run tauri:build` con las credenciales de firma. Definicion: `.claude/skills/build/SKILL.md`

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

## Sistema de Roles (Developer vs Usuario Regular)

- **Developers**: Emails con dominio `@asertio.mx` o `@maity.cloud` -> interfaz completa
- **Usuarios regulares**: Interfaz restringida (sin Gamificacion/Conversaciones en sidebar, settings limitados, transcripcion forzada a Deepgram nova-3 es-419)
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
- **Ramas de Git**: `main` (releases), `fix/*`, `enhance/*`, `feat/*`
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
