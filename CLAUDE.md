# CLAUDE.md

Este archivo proporciona orientación a Claude Code (claude.ai/code) al trabajar con el código de este repositorio.

## Descripción del Proyecto

**Meetily (Maity Desktop)** es un asistente de reuniones con IA enfocado en privacidad que captura, transcribe y resume reuniones completamente en infraestructura local. El proyecto consta de dos componentes principales:

1. **Frontend**: Aplicación de escritorio basada en Tauri (Rust + Next.js + TypeScript)
2. **Backend**: Servidor FastAPI para almacenamiento de reuniones y resúmenes con LLM (Python)

### Stack Tecnológico Principal
- **App de Escritorio**: Tauri 2.x (Rust) + Next.js 14 + React 18
- **Procesamiento de Audio**: Rust (cpal, whisper-rs, mezcla de audio profesional)
- **Transcripción**: Whisper.cpp (local, acelerado por GPU) + Deepgram (nube, opcional)
- **Backend API**: FastAPI + SQLite (aiosqlite)
- **Integración LLM**: Ollama (local), Claude, Groq, OpenRouter

## Comandos Esenciales de Desarrollo

### Desarrollo Frontend (App de Escritorio Tauri)

**Ubicación**: `/frontend`

```bash
# Desarrollo en macOS
./clean_run.sh              # Build limpio y ejecutar con logging info
./clean_run.sh debug        # Ejecutar con logging debug
./clean_build.sh            # Build de producción

# Desarrollo en Windows
clean_run_windows.bat       # Build limpio y ejecutar
clean_build_windows.bat     # Build de producción

# Comandos Manuales
pnpm install                # Instalar dependencias
pnpm run dev                # Servidor dev Next.js (puerto 3118)
pnpm run tauri:dev          # Modo desarrollo completo Tauri
pnpm run tauri:build        # Build de producción

# Builds específicos por GPU (para probar aceleración)
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # Solo CPU (sin GPU)
```

### Desarrollo Backend (Servidor FastAPI)

**Ubicación**: `/backend`

```bash
# macOS
./build_whisper.sh small              # Compilar Whisper con modelo 'small'
./clean_start_backend.sh              # Iniciar servidor FastAPI (puerto 5167)

# Windows
build_whisper.cmd small               # Compilar Whisper con modelo
start_with_output.ps1                 # Configuración interactiva e inicio
clean_start_backend.cmd               # Iniciar servidor

# Docker (Multiplataforma)
./run-docker.sh start --interactive   # Configuración interactiva (macOS/Linux)
.\run-docker.ps1 start -Interactive   # Configuración interactiva (Windows)
./run-docker.sh logs --service app    # Ver logs
```

**Modelos Whisper Disponibles**: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`

### Endpoints de Servicios
- **API Backend**: http://localhost:5167 (opcional, para persistencia y resúmenes LLM)
- **Documentación Backend**: http://localhost:5167/docs
- **Frontend Dev**: http://localhost:3118

## Arquitectura de Alto Nivel

### Arquitectura de Tres Niveles

```
┌─────────────────────────────────────────────────────────────────┐
│                Frontend (App de Escritorio Tauri)                │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   UI Next.js     │  │  Backend Rust   │  │ Motor Whisper  │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (STT Local)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Eventos Tauri         ↑ Pipeline de Audio             │
└─────────┼────────────────────────┼─────────────────────────────┘
          │ HTTP/WebSocket         │
          ↓                        │
┌─────────────────────────────────┼─────────────────────────────┐
│              Backend (FastAPI)  │                              │
│  ┌────────────┐  ┌─────────────┴──────┐  ┌────────────────┐  │
│  │   SQLite   │←→│ Gestor Reuniones   │←→│ Proveedor LLM  │  │
│  │ (Reuniones)│  │ (CRUD + Resumen)   │  │ (Ollama/etc.)  │  │
│  └────────────┘  └────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline de Procesamiento de Audio (Comprensión Crítica)

El sistema de audio tiene **tres rutas paralelas** con propósitos distintos:

```
Audio Crudo (Micrófono + Sistema)
         ↓
┌────────────────────────────────────────────────────────────────┐
│              Gestor del Pipeline de Audio                       │
│  (frontend/src-tauri/src/audio/pipeline.rs)                    │
└──────┬──────────────────┬──────────────────┬──────────────────┘
       ↓                  ↓                  ↓
┌──────────────┐  ┌───────────────┐  ┌───────────────────────┐
│ Ruta de      │  │ Ruta de       │  │ Ruta de               │
│ Grabación    │  │ Transcripción │  │ Transcripción Nube    │
│ (Stereo L/R) │  │ (VAD local)   │  │ (Deepgram WebSocket)  │
└──────────────┘  └───────────────┘  └───────────────────────┘
       ↓                  ↓                  ↓
RecordingSaver     WhisperEngine      DeepgramProvider
(L=mic, R=sistema) (solo voz)        (streaming en vivo)
```

**Puntos Clave**:
- **Grabación stereo**: El audio se entrelaza como stereo (canal izquierdo = micrófono/usuario, canal derecho = sistema/interlocutor) para permitir separación posterior de hablantes.
- **VAD dual-canal**: Procesadores VAD independientes para micrófono (`mic_vad_processor`) y sistema (`sys_vad_processor`), permitiendo detección de voz por fuente de audio separada.
- **Atribución de hablante**: El `DeviceType` (Microphone/System) se captura ANTES de enviar al motor de transcripción, mapeando `Microphone→"user"` y `System→"interlocutor"`.

### Modularización de Dispositivos de Audio (Completada)

**Contexto**: El sistema de audio fue refactorizado de un archivo monolítico `core.rs` de 1028 líneas a módulos enfocados.

```
audio/
├── devices/                    # Descubrimiento y configuración de dispositivos
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   ├── microphone.rs          # default_input_device
│   ├── speakers.rs            # default_output_device
│   ├── configuration.rs       # Tipos AudioDevice, parsing
│   └── platform/              # Implementaciones por plataforma
│       ├── windows.rs         # Lógica WASAPI (~200 líneas)
│       ├── macos.rs           # Lógica ScreenCaptureKit
│       └── linux.rs           # Lógica ALSA/PulseAudio
├── capture/                   # Captura de streams de audio
│   ├── microphone.rs          # Stream de captura de micrófono
│   ├── system.rs              # Stream de captura de audio del sistema
│   └── core_audio.rs          # Integración ScreenCaptureKit macOS
├── transcription/             # Motor de transcripción
│   ├── engine.rs              # Gestión de motores (Whisper + Parakeet)
│   ├── worker.rs              # Pool de workers de transcripción
│   └── deepgram_provider.rs   # Proveedor Deepgram (nube, WebSocket)
├── pipeline.rs                # Mezcla de audio, VAD y distribución
├── recording_manager.rs       # Coordinación de grabación de alto nivel
├── recording_commands.rs      # Interfaz de comandos Tauri
├── recording_saver.rs         # Escritura de archivos de audio
├── incremental_saver.rs       # Guardado incremental con checkpoints (30s)
└── encode.rs                  # Codificación FFmpeg (PCM → AAC/MP4)
```

**Al trabajar en funcionalidades de audio**:
- Problemas de detección de dispositivos → `devices/discovery.rs` o `devices/platform/{windows,macos,linux}.rs`
- Problemas de micrófono/altavoces → `devices/microphone.rs` o `devices/speakers.rs`
- Problemas de captura de audio → `capture/microphone.rs` o `capture/system.rs`
- Problemas de mezcla/procesamiento → `pipeline.rs`
- Flujo de grabación → `recording_manager.rs` + `recording_saver.rs` + `incremental_saver.rs`
- Transcripción local → `transcription/engine.rs` + `transcription/worker.rs`
- Transcripción nube → `transcription/deepgram_provider.rs`

### Comunicación Rust ↔ Frontend (Arquitectura Tauri)

**Patrón de Comandos** (Frontend → Rust):
```typescript
// Frontend: src/app/page.tsx
await invoke('start_recording', {
  mic_device_name: "Built-in Microphone",
  system_device_name: "BlackHole 2ch",
  meeting_name: "Team Standup"
});
```

```rust
// Rust: src/lib.rs
#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>
) -> Result<(), String> {
    // La implementación delega a audio::recording_commands
}
```

**Patrón de Eventos** (Rust → Frontend):
```rust
// Rust: Emitir actualizaciones de transcripción
app.emit("transcript-update", TranscriptUpdate {
    text: "Hello world".to_string(),
    timestamp: chrono::Utc::now(),
    // ...
})?;
```

```typescript
// Frontend: Escuchar eventos
await listen<TranscriptUpdate>('transcript-update', (event) => {
  setTranscripts(prev => [...prev, event.payload]);
});
```

### Gestión de Modelos Whisper

**Ubicaciones de Almacenamiento de Modelos**:
- **Desarrollo**: `frontend/models/`
- **Producción (macOS)**: `~/Library/Application Support/com.maity.ai/models/`
- **Producción (Windows)**: `%APPDATA%\com.maity.ai\models\`

**Carga de Modelos** (frontend/src-tauri/src/whisper_engine/whisper_engine.rs):
```rust
pub async fn load_model(&self, model_name: &str) -> Result<()> {
    // Detecta automáticamente capacidades GPU (Metal/CUDA/Vulkan)
    // Usa CPU como fallback si GPU no está disponible
}
```

**Aceleración por GPU**:
- **macOS**: Metal + CoreML (habilitado automáticamente)
- **Windows/Linux**: CUDA (NVIDIA), Vulkan (AMD/Intel), o CPU
- Configurar vía features de Cargo: `--features cuda`, `--features vulkan`

## Patrones Críticos de Desarrollo

### 1. Gestión de Buffers de Audio

**Ring Buffer de Mezcla** (pipeline.rs):
- El audio de micrófono y sistema llega asincrónicamente a diferentes velocidades
- El Ring Buffer acumula muestras hasta que ambos streams tienen ventanas alineadas (50ms)
- La mezcla profesional aplica ducking basado en RMS para evitar que el audio del sistema ahogue al micrófono
- Usa `VecDeque` para procesamiento eficiente por ventanas
- **Nota**: Para grabación, el audio ahora se entrelaza como stereo (L=mic, R=system) en lugar de mezclarse a mono

### 2. Seguridad de Hilos y Límites Async

**Estado de Grabación** (recording_state.rs):
```rust
pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    audio_sender: Arc<RwLock<Option<mpsc::UnboundedSender<AudioChunk>>>>,
    // ...
}
```

**Patrón Clave**: Usar `Arc<RwLock<T>>` para estado compartido entre tareas async, `Arc<AtomicBool>` para flags simples. Los mutex deben adquirirse con `.lock().map_err()` en lugar de `.lock().unwrap()` para evitar panics por envenenamiento de mutex.

### 3. Manejo de Errores y Logging

**Logging Consciente del Rendimiento** (lib.rs):
```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // Costo cero en builds de release
}
```

**Uso**: Usar `perf_debug!()` y `perf_trace!()` para logging en rutas críticas que debe eliminarse en producción.

### 4. Gestión de Estado del Frontend

**Contexto del Sidebar** (components/Sidebar/SidebarProvider.tsx):
- Estado global para lista de reuniones, reunión actual, estado de grabación
- Se comunica con API backend (http://localhost:5167)
- Gestiona conexiones WebSocket para actualizaciones en tiempo real

**Patrón**: Comandos Tauri actualizan estado Rust → Emiten eventos → Listeners del frontend actualizan estado React → El contexto se propaga a los componentes

## Tareas Comunes de Desarrollo

### Agregar una Nueva Plataforma de Dispositivo de Audio

1. Crear archivo de plataforma: `audio/devices/platform/{nombre_plataforma}.rs`
2. Implementar enumeración de dispositivos para la plataforma
3. Agregar configuración específica en `audio/devices/configuration.rs`
4. Actualizar `audio/devices/platform/mod.rs` para exportar funciones de la nueva plataforma
5. Probar con `cargo check` y tests específicos de dispositivos por plataforma

### Agregar un Nuevo Comando Tauri

1. Definir comando en `src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn mi_comando(arg: String) -> Result<String, String> { /* ... */ }
   ```
2. Registrar en `tauri::Builder`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_recording,
       mi_comando,  // Agregar aquí
   ])
   ```
3. Llamar desde el frontend:
   ```typescript
   const result = await invoke<string>('mi_comando', { arg: 'valor' });
   ```

### Modificar Comportamiento del Pipeline de Audio

**Ubicación**: `frontend/src-tauri/src/audio/pipeline.rs`

Componentes clave:
- `AudioMixerRingBuffer`: Gestiona sincronización de audio mic + sistema
- `ProfessionalAudioMixer`: Ducking basado en RMS y mezcla (reservado para posible uso futuro en mono)
- `AudioPipelineManager`: Orquesta VAD, entrelazado stereo y distribución

**Probar Cambios de Audio**:
```bash
# Habilitar logging verbose de audio
RUST_LOG=app_lib::audio=debug ./clean_run.sh

# Monitorear métricas de audio en tiempo real
# Revisar Consola de Desarrollador en la app (Cmd+Shift+I en macOS)
```

### Desarrollo de API Backend

**Agregar Nuevos Endpoints** (backend/app/main.py):
```python
@app.post("/api/mi-endpoint")
async def mi_endpoint(request: MiRequest) -> MiResponse:
    # Usar DatabaseManager para persistencia
    db = DatabaseManager()
    result = await db.alguna_operacion()
    return result
```

**Operaciones de Base de Datos** (backend/app/db.py):
- Todos los datos de reuniones almacenados en SQLite
- Usar la clase `DatabaseManager` para todas las operaciones de BD
- Operaciones async con `aiosqlite`

## Testing y Depuración

### Depuración del Frontend

**Habilitar Logging de Rust**:
```bash
# macOS
RUST_LOG=debug ./clean_run.sh

# Windows (PowerShell)
$env:RUST_LOG="debug"; ./clean_run_windows.bat
```

**Herramientas de Desarrollador**:
- Abrir DevTools: `Cmd+Shift+I` (macOS) o `Ctrl+Shift+I` (Windows)
- Toggle de Consola: Integrado en la UI de la app (ícono de consola)
- Ver logs de Rust: Revisar salida del terminal

**ChunkLoadError Recovery** (modo desarrollo):
- Un script inline en `layout.tsx` se ejecuta **antes** de que React cargue
- Detecta `ChunkLoadError`, `Loading chunk failed`, y errores de dynamic imports
- Recarga automáticamente la página después de 2 segundos
- Máximo 3 intentos de recarga antes de detener (evita loops infinitos)
- Los logs en consola muestran `[ChunkErrorRecovery]` con el estado de recuperación
- Si persiste después de 3 intentos, reiniciar el servidor dev: `pnpm run tauri:dev`
- Implementación: Script inline con `next/script` strategy `beforeInteractive` en `layout.tsx`
- Componente backup: `frontend/src/components/shared/ChunkErrorRecovery.tsx`

### Depuración del Backend

**Ver Logs de API**:
```bash
# Los logs del backend se muestran en terminal con formato detallado:
# 2025-01-03 12:34:56 - INFO - [main.py:123 - nombre_endpoint()] - Mensaje
```

**Probar API Directamente**:
- Swagger UI: http://localhost:5167/docs
- ReDoc: http://localhost:5167/redoc

### Depuración del Pipeline de Audio

**Métricas Clave** (emitidas por el pipeline):
- Tamaños de buffer (mic/sistema)
- Conteo de ventanas de mezcla
- Tasa de detección VAD (mic y sistema por separado)
- Advertencias de chunks descartados
- Estado de backpressure del canal de transcripción

**Monitorear vía Consola de Desarrollador**: La app incluye visualización de métricas en tiempo real durante la grabación.

## Notas por Plataforma

### macOS
- **Captura de Audio**: Usa ScreenCaptureKit para audio del sistema (macOS 13+)
- **GPU**: Metal + CoreML habilitados automáticamente
- **Permisos**: Requiere permisos de micrófono + grabación de pantalla
- **Audio del Sistema**: Requiere dispositivo de audio virtual (BlackHole) para captura del sistema

### Windows
- **Captura de Audio**: Usa WASAPI (Windows Audio Session API)
- **GPU**: CUDA (NVIDIA) o Vulkan (AMD/Intel) vía features de Cargo
- **Herramientas de Build**: Requiere Visual Studio Build Tools 2022 con carga de trabajo C++
- **LLVM/Clang**: Requerido por `whisper-rs-sys` (bindgen necesita `libclang.dll`):
  ```powershell
  # Instalar LLVM
  winget install LLVM.LLVM

  # Configurar variable de entorno (PowerShell como admin)
  [System.Environment]::SetEnvironmentVariable("LIBCLANG_PATH", "C:\Program Files\LLVM\bin", "User")
  ```
- **Audio del Sistema**: Usa WASAPI loopback para captura del sistema
- **FFmpeg**: Requerido para codificar grabaciones (busca en PATH, recursos de la app, o directorio de trabajo)

### Linux
- **Captura de Audio**: ALSA/PulseAudio
- **GPU**: CUDA (NVIDIA) o Vulkan vía features de Cargo
- **Dependencias**: Requiere cmake, llvm, libomp

## Directrices de Optimización de Rendimiento

### Procesamiento de Audio
- Usar `perf_debug!()` / `perf_trace!()` para logging en rutas críticas (costo cero en release)
- Agrupar métricas de audio usando `AudioMetricsBatcher` (pipeline.rs)
- Pre-asignar buffers con `AudioBufferPool` (buffer_pool.rs)
- El filtrado VAD reduce la carga de Whisper en ~70% (solo procesa voz)
- El guardado incremental con checkpoints de 30s previene pérdida de datos por crashes

### Transcripción Whisper
- **Selección de Modelo**: Balance entre precisión y velocidad
  - Desarrollo: `base` o `small` (iteración rápida)
  - Producción: `medium` o `large-v3` (mejor calidad)
- **Aceleración GPU**: 5-10x más rápido que CPU
- **Procesamiento Paralelo**: Disponible en `whisper_engine/parallel_processor.rs` para cargas por lotes

### Rendimiento del Frontend
- Actualizaciones de estado React agrupadas vía contexto del Sidebar
- Renderizado de transcripciones virtualizado para reuniones largas
- Monitoreo de nivel de audio limitado a 60fps

## Restricciones Importantes y Consideraciones

1. **Tamaño de Chunk de Audio**: El pipeline espera frecuencia de muestreo consistente de 48kHz. El remuestreo ocurre al momento de la captura.

2. **Particularidades de Audio por Plataforma**:
   - macOS: ScreenCaptureKit requiere macOS 13+, necesita permiso de grabación de pantalla
   - Windows: El modo exclusivo de WASAPI puede entrar en conflicto con otras apps
   - Audio del sistema requiere dispositivo virtual (BlackHole en macOS, WASAPI loopback en Windows)

3. **Carga de Modelos Whisper**: Los modelos se cargan una vez y se cachean. Cambiar modelos requiere reinicio de la app o descarga/recarga manual.

4. **Dependencia del Backend**: El frontend puede ejecutarse standalone (Whisper local), pero la persistencia de reuniones y funcionalidades LLM requieren el backend ejecutándose.

5. **Configuración CORS**: El backend permite todos los orígenes (`"*"`) para desarrollo. Restringir para despliegue en producción.

6. **Rutas de Archivos**: Usar APIs de rutas de Tauri (`downloadDir`, etc.) para compatibilidad multiplataforma. Nunca hardcodear rutas.

7. **Permisos de Audio**: Solicitar permisos tempranamente. macOS requiere tanto micrófono COMO grabación de pantalla para audio del sistema.

8. **Grabación Stereo**: Las grabaciones se guardan como audio stereo entrelazado (L=micrófono, R=sistema). El `IncrementalAudioSaver` maneja checkpoints cada 30 segundos con `channels=2`.

9. **Seguridad de Mutex**: Todos los locks de mutex en el motor de transcripción usan `.lock().map_err()` en lugar de `.lock().unwrap()` para evitar panics por envenenamiento de mutex.

## Convenciones del Repositorio

- **Formato de Logging**: El backend usa formato detallado con filename:line:function
- **Manejo de Errores**: Rust usa `anyhow::Result`, el frontend usa try-catch con mensajes amigables para el usuario
- **Nomenclatura**: Los dispositivos de audio usan "microphone" y "system" consistentemente (no "input"/"output")
- **Ramas de Git**:
  - `main`: Releases estables
  - `fix/*`: Correcciones de bugs
  - `enhance/*`: Mejoras de funcionalidades
  - `feat/*`: Funcionalidades nuevas

## Deepgram Cloud Proxy (Transcripción en la Nube)

El sistema de transcripción en la nube usa Deepgram como proveedor. **Los usuarios NO configuran su propia API key** - se usa la API key del proyecto via cloud proxy.

> **Nota**: El endpoint `/v1/auth/grant` de Deepgram para generar tokens temporales requiere un plan de pago. En el plan gratuito, la Edge Function retorna la API key directamente (igual que hace OMI).

### Modelos y Idiomas Soportados

**Modelos Deepgram disponibles**:
- `nova-3` (Recomendado) - Modelo más reciente con soporte mejorado para español latinoamericano
- `nova-2` - Modelo estable de propósito general
- `nova-2-phonecall` - Optimizado para audio de llamadas telefónicas
- `nova-2-meeting` - Optimizado para transcripción de reuniones

**Idiomas soportados**:
- `es-419` - Español Latinoamericano (Recomendado para usuarios en LATAM)
- `es` - Español (España)
- `en` - Inglés
- `multi` - Multilingüe (detección automática)

**Configuración por defecto**: Nova-3 con idioma `es-419` (español latinoamericano).

La configuración de modelo e idioma se guarda en la tabla `transcript_settings` de SQLite y persiste entre sesiones.

### Arquitectura

```
┌─────────────────────┐     ┌──────────────────────────┐
│   App Tauri/Rust    │────>│  Supabase Edge Function  │
│                     │     │  (deepgram-token)        │
│  1. Usuario inicia  │     │                          │
│     grabación       │     │  2. Valida JWT Supabase  │
│                     │<────│  3. Retorna API key      │
│  4. Conecta a       │     └──────────────────────────┘
│     Deepgram WS     │─────────────────────────────────>
│     con API key     │                                 Deepgram WebSocket
└─────────────────────┘
```

### Flujo de Autenticación

1. **Usuario inicia grabación** con provider "deepgram"
2. **Frontend** (`useRecordingStart.ts`):
   - Llama a `getDeepgramToken()` de `frontend/src/lib/deepgram.ts`
   - Esto hace fetch a la Edge Function `deepgram-token` con el JWT de Supabase
3. **Edge Function** (`supabase/functions/deepgram-token`):
   - Valida el JWT del usuario
   - Retorna la API key de Deepgram directamente (no llama a `/v1/auth/grant`)
4. **Frontend** pasa el token a Rust via `set_deepgram_cloud_token`
5. **Rust** (`engine.rs`) crea el transcriber con `DeepgramRealtimeTranscriber::with_cloud_token(token)`
6. **Rust** conecta a Deepgram WebSocket con `Authorization: Token {api_key}`

### Archivos Relevantes

| Archivo | Descripción |
|---------|-------------|
| `frontend/src/lib/deepgram.ts` | Cliente TypeScript para obtener tokens del cloud proxy |
| `frontend/src/hooks/useRecordingStart.ts` | Hook que obtiene token antes de iniciar grabación |
| `frontend/src-tauri/src/audio/transcription/deepgram_commands.rs` | Comandos Tauri para gestionar tokens en cache |
| `frontend/src-tauri/src/audio/transcription/deepgram_provider.rs` | Proveedor de transcripción con soporte para cloud tokens |
| `frontend/src-tauri/src/audio/transcription/engine.rs` | Lógica de inicialización del motor de transcripción |

### Configuración Requerida (Supabase)

1. **Secret**: Configurar `DEEPGRAM_API_KEY` en Supabase Dashboard:
   - Ir a Project Settings → Edge Functions → Secrets
   - Agregar `DEEPGRAM_API_KEY` con la API key de Deepgram

2. **Edge Function**: Ya desplegada como `deepgram-token` con `verify_jwt: true`

### Requisitos para el Usuario

- Debe estar autenticado con Supabase (login con Google)
- NO necesita configurar su propia API key de Deepgram
- La API key se obtiene del cloud proxy en cada sesión (sin expiración)

## Referencia de Archivos Clave

**Coordinación Principal**:
- [frontend/src-tauri/src/lib.rs](frontend/src-tauri/src/lib.rs) - Punto de entrada principal de Tauri, registro de comandos
- [frontend/src-tauri/src/audio/mod.rs](frontend/src-tauri/src/audio/mod.rs) - Exportaciones del módulo de audio
- [backend/app/main.py](backend/app/main.py) - Aplicación FastAPI, endpoints de API

**Sistema de Audio**:
- [frontend/src-tauri/src/audio/recording_manager.rs](frontend/src-tauri/src/audio/recording_manager.rs) - Orquestación de grabación
- [frontend/src-tauri/src/audio/pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs) - Mezcla de audio, VAD dual-canal y distribución
- [frontend/src-tauri/src/audio/recording_saver.rs](frontend/src-tauri/src/audio/recording_saver.rs) - Escritura de archivos de audio
- [frontend/src-tauri/src/audio/incremental_saver.rs](frontend/src-tauri/src/audio/incremental_saver.rs) - Guardado incremental con checkpoints
- [frontend/src-tauri/src/audio/encode.rs](frontend/src-tauri/src/audio/encode.rs) - Codificación FFmpeg

**Sistema de Transcripción**:
- [frontend/src-tauri/src/audio/transcription/engine.rs](frontend/src-tauri/src/audio/transcription/engine.rs) - Gestión de motores de transcripción
- [frontend/src-tauri/src/audio/transcription/worker.rs](frontend/src-tauri/src/audio/transcription/worker.rs) - Pool de workers de transcripción
- [frontend/src-tauri/src/audio/transcription/deepgram_provider.rs](frontend/src-tauri/src/audio/transcription/deepgram_provider.rs) - Proveedor Deepgram (nube, WebSocket streaming)
- [frontend/src-tauri/src/audio/transcription/deepgram_commands.rs](frontend/src-tauri/src/audio/transcription/deepgram_commands.rs) - Comandos Tauri para gestión de tokens cloud
- [frontend/src/lib/deepgram.ts](frontend/src/lib/deepgram.ts) - Cliente TypeScript para obtener tokens del cloud proxy

**Componentes UI**:
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Interfaz principal de grabación
- [frontend/src/components/Sidebar/SidebarProvider.tsx](frontend/src/components/Sidebar/SidebarProvider.tsx) - Gestión de estado global
- [frontend/src/components/shared/ChunkErrorRecovery.tsx](frontend/src/components/shared/ChunkErrorRecovery.tsx) - Recuperación automática de ChunkLoadError en desarrollo

**Feature: Gamificación** (Volcán de progreso):
- [frontend/src/features/gamification/components/GamifiedDashboard.tsx](frontend/src/features/gamification/components/GamifiedDashboard.tsx) - Dashboard principal gamificado
- [frontend/src/features/gamification/components/MountainMap.tsx](frontend/src/features/gamification/components/MountainMap.tsx) - Visualización SVG del volcán con nodos de progreso
- [frontend/src/features/gamification/components/MetricsPanel.tsx](frontend/src/features/gamification/components/MetricsPanel.tsx) - Panel de métricas (XP, racha, competencias)
- [frontend/src/features/gamification/components/InfoPanel.tsx](frontend/src/features/gamification/components/InfoPanel.tsx) - Panel de ranking y muletillas
- [frontend/src/features/gamification/hooks/useGamifiedDashboardData.ts](frontend/src/features/gamification/hooks/useGamifiedDashboardData.ts) - Hook para cargar datos de conversaciones y calcular nodos
- [frontend/src/app/gamification/page.tsx](frontend/src/app/gamification/page.tsx) - Página /gamification

**Feature: Conversaciones OMI**:
- [frontend/src/features/conversations/components/ConversationsList.tsx](frontend/src/features/conversations/components/ConversationsList.tsx) - Lista de conversaciones con Cards clickeables
- [frontend/src/features/conversations/components/ConversationDetail.tsx](frontend/src/features/conversations/components/ConversationDetail.tsx) - Detalle de conversación (análisis, transcripción)
- [frontend/src/features/conversations/services/conversations.service.ts](frontend/src/features/conversations/services/conversations.service.ts) - Servicio para CRUD de conversaciones OMI desde Supabase
- [frontend/src/app/conversations/page.tsx](frontend/src/app/conversations/page.tsx) - Página /conversations

**Integración Whisper**:
- [frontend/src-tauri/src/whisper_engine/whisper_engine.rs](frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Gestión de modelos Whisper y transcripción

**Scripts de Evaluación**:
- [scripts/test_moonshine_spanish.py](scripts/test_moonshine_spanish.py) - Script para probar Moonshine base-es en español
- [scripts/generate_test_audio.py](scripts/generate_test_audio.py) - Grabador de audios de prueba para evaluación
- [scripts/requirements_moonshine.txt](scripts/requirements_moonshine.txt) - Dependencias Python para pruebas de Moonshine
- [scripts/moonshine_evaluation_results.md](scripts/moonshine_evaluation_results.md) - Plantilla para documentar resultados de evaluación

---

## Protocolo Guardian - Modo Protegido

Este protocolo establece reglas de seguridad para el desarrollo del proyecto. Se activa automáticamente al trabajar con este repositorio.

### 1. Respaldo Pre-Cambio (Solo Alto Riesgo)

Crear rama de backup **antes** de cambios de alto riesgo:
- Refactoring grande (>3 archivos o >200 líneas)
- Cambios en el pipeline de audio (`pipeline.rs`, `recording_manager.rs`)
- Cambios en el motor de transcripción (`engine.rs`, `worker.rs`)
- Modificaciones a `lib.rs` o al sistema de comandos Tauri
- Eliminación o reescritura de módulos completos

```bash
# Formato de rama de backup
git checkout -b backup/{fecha}-{descripcion-corta}
git checkout -    # Volver a la rama de trabajo
```

**NO se requiere backup para**: edits menores, correcciones de bugs puntuales, cambios de UI, actualizaciones de dependencias, cambios en documentación.

### 2. Protocolo de Compilación (OBLIGATORIO — SIN EXCEPCIONES)

**REGLA ABSOLUTA**: Después de CADA cambio de código, se DEBE ejecutar el build completo integrado de Tauri. NUNCA se debe entregar, hacer commit, ni reportar completado sin que el build haya pasado con exit code 0.

**Build obligatorio después de cada cambio**:
```bash
cd frontend && pnpm run tauri:build     # OBLIGATORIO - Build integrado Tauri
```
Este comando ejecuta la cadena completa: `pnpm build` (Next.js) → `cargo build --release` (Rust) → empaqueta frontend + backend en un ejecutable funcional con instaladores MSI/NSIS.

**Criterio de éxito del build**: El proceso DEBE terminar con exit code 0. Si termina con exit code 1 o cualquier otro error, el build NO pasó y se debe corregir antes de entregar.

**Nota sobre firma local**: El script `tauri-auto.js` maneja correctamente la ausencia de `TAURI_SIGNING_PRIVATE_KEY` en desarrollo local. Si la compilación y empaquetado son exitosos pero falta la clave de firma (solo necesaria en CI/CD), el script reporta un warning y sale con code 0. Esto es el comportamiento esperado en desarrollo local.

**PROHIBIDO**:
- Usar `cargo build` o `cargo build --release` como build final (solo compilan Rust, no integran frontend)
- Hacer commit sin build exitoso (exit code 0)
- Reportar tarea completada sin build exitoso
- Decir "el build pasó" si el exit code no fue 0
- Entregar código con build que retorne exit code distinto de 0

**Para desarrollo interactivo** (probar la app en modo dev):
```bash
cd frontend && pnpm run tauri:dev       # Inicia servidor Next.js + backend Rust en modo debug
```

**Ubicación de los artefactos generados**:
- Ejecutable: `target/release/maity-desktop.exe`
- Instalador MSI: `target/release/bundle/msi/Maity_0.2.0_x64_en-US.msi`
- Instalador NSIS: `target/release/bundle/nsis/Maity_0.2.0_x64-setup.exe`

**Reportar resultado obligatoriamente**:
- **pnpm run tauri:build**: EXIT CODE 0 (OK) / EXIT CODE != 0 (FALLO) + errores completos
- Si FALLO: NO hacer commit, NO reportar completado, CORREGIR primero

**Si el build falla**: Corregir INMEDIATAMENTE antes de hacer cualquier otra cosa. Un cambio con build roto no es un cambio terminado. NUNCA hacer commit con build fallido.

### 3. Alerta de Cambios Peligrosos

Si el usuario solicita alguna de estas acciones, **advertir y proponer enfoque incremental**:
- Eliminar archivos completos del sistema de audio
- Reescribir módulos enteros desde cero
- Cambiar la arquitectura del pipeline de audio
- Modificar el formato de comunicación Rust ↔ Frontend
- Eliminar o reemplazar sistemas de seguridad existentes (manejo de errores, logging)

Formato de advertencia:
> **Cambio de alto riesgo detectado**: [descripción]. Este cambio afecta [componentes]. Propongo un enfoque incremental: [pasos].

### 4. Formato de Commits

Usar prefijos estándar con descripción en español:

```
feat: descripción de nueva funcionalidad
fix: descripción de corrección de bug
docs: descripción de cambio en documentación
refactor: descripción de refactorización
style: cambios de formato/estilo (sin cambio funcional)
test: agregar o modificar tests
chore: tareas de mantenimiento
```

Ejemplo: `feat: agregar grabación stereo dual-canal (L=mic, R=sistema)`

### 5. Git Seguro

Reglas estrictas de seguridad en git:
- **NUNCA** ejecutar `git push --force` sin permiso explícito del usuario
- **NUNCA** ejecutar `git reset --hard` sin permiso explícito
- **NUNCA** hacer merge directo a `main` sin permiso explícito
- **NUNCA** ejecutar `git clean -f` sin permiso explícito
- Preferir `git add` con archivos específicos en lugar de `git add -A`
- No incluir archivos sensibles (.env, credenciales, claves API)

### 6. Estado del Proyecto (Inicio de Sesión)

Al inicio de cada sesión de trabajo, verificar y mostrar:
- Rama actual de git
- Último commit (hash corto + mensaje)
- Si hay cambios sin commit
- Si hay archivos sin rastrear relevantes

### 7. Resumen de Sesión

Al terminar trabajo significativo, listar:
- Archivos modificados y naturaleza del cambio
- Resultado de compilación (los 3 builds)
- Tareas completadas vs pendientes
- Cualquier advertencia o problema encontrado
