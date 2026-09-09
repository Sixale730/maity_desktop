# Transcription Pipeline Documentation

## Overview

This document describes the audio transcription pipeline in Maity, including capture, processing, and event emission to the frontend.

## Architecture Diagram

```
                    +------------------+
                    |   User Clicks    |
                    |  Start Recording |
                    +--------+---------+
                             |
                             v
+---------------------------+---------------------------+
|                    Frontend (React/Next.js)           |
|  - RecordingControls.tsx                              |
|  - invoke('start_recording', {mic, system, meeting})  |
+---------------------------+---------------------------+
                             |
                             | Tauri IPC
                             v
+---------------------------+---------------------------+
|                    Tauri Command Layer                |
|  - lib.rs: start_recording command                    |
|  - recording_commands.rs: orchestration               |
+---------------------------+---------------------------+
                             |
                             v
+---------------------------+---------------------------+
|                    Audio Capture Layer                |
|  +---------------+    +------------------+            |
|  | Microphone    |    | System Audio     |            |
|  | (cpal)        |    | (WASAPI/CoreAudio)|           |
|  +-------+-------+    +--------+---------+            |
|          |                     |                      |
|          +----------+----------+                      |
|                     |                                 |
|                     v                                 |
|            +--------+--------+                        |
|            | Audio Pipeline  |                        |
|            | (pipeline.rs)   |                        |
|            | - Mix channels  |                        |
|            | - Apply VAD     |                        |
|            | - Chunk audio   |                        |
|            +--------+--------+                        |
+---------------------------+---------------------------+
                             |
                             | AudioChunk (tokio channel)
                             v
+---------------------------+---------------------------+
|                 Transcription Layer                   |
|  +--------------------+                               |
|  | worker.rs          |                               |
|  | - Receives chunks  |                               |
|  | - Parallel workers |                               |
|  +----------+---------+                               |
|             |                                         |
|             v                                         |
|  +----------+---------+                               |
|  | TranscriptionEngine|                               |
|  | (engine.rs)        |                               |
|  +----------+---------+                               |
|             |                                         |
|    +--------+--------+--------+                       |
|    |                 |        |                       |
|    v                 v        v                       |
| +------+      +--------+  +----------+                |
| |Whisper|     |Parakeet|  |Provider  |  <-- NEW      |
| +------+      +--------+  |(trait)   |                |
|                           +----------+                |
+---------------------------+---------------------------+
                             |
                             | app.emit()
                             v
+---------------------------+---------------------------+
|                    Event Emission                     |
|  - "transcript-update"                                |
|  - "transcription-error"                              |
|  - "speech-detected"                                  |
|  - "transcription-progress"                           |
+---------------------------+---------------------------+
                             |
                             | Tauri Event Bus
                             v
+---------------------------+---------------------------+
|                    Frontend Listeners                 |
|  - TranscriptContext.tsx                              |
|  - transcriptService.ts                               |
|  - TranscriptPanel.tsx (UI update)                    |
+---------------------------+---------------------------+
```

## Key Files

### Audio Capture

| File | Location | Purpose |
|------|----------|---------|
| `recording_commands.rs` | `src/audio/` | Tauri commands for start/stop recording |
| `recording_manager.rs` | `src/audio/` | Orchestrates recording lifecycle |
| `pipeline.rs` | `src/audio/` | Audio mixing and VAD processing |
| `microphone.rs` | `src/audio/capture/` | Microphone capture via cpal |
| `system.rs` | `src/audio/capture/` | System audio capture (WASAPI/CoreAudio) |

### Transcription

| File | Location | Purpose |
|------|----------|---------|
| `provider.rs` | `src/audio/transcription/` | `TranscriptionProvider` trait definition |
| `engine.rs` | `src/audio/transcription/` | `TranscriptionEngine` enum and initialization |
| `worker.rs` | `src/audio/transcription/` | Parallel worker pool and event emission |
| `whisper_provider.rs` | `src/audio/transcription/` | Whisper implementation |
| `parakeet_provider.rs` | `src/audio/transcription/` | Parakeet (ONNX) implementation |

### Configuration

| File | Location | Purpose |
|------|----------|---------|
| `api.rs` | `src/api/` | `TranscriptConfig` struct and API calls |
| `lib.rs` | `src/` | Tauri app initialization and command registration |

## TranscriptionProvider Trait

```rust
// provider.rs
#[async_trait]
pub trait TranscriptionProvider: Send + Sync {
    async fn transcribe(
        &self,
        audio: Vec<f32>,           // 16kHz mono audio samples
        language: Option<String>,  // Language hint (e.g., "en", "es")
    ) -> Result<TranscriptResult, TranscriptionError>;

    async fn is_model_loaded(&self) -> bool;
    async fn get_current_model(&self) -> Option<String>;
    fn provider_name(&self) -> &'static str;
}
```

## TranscriptResult Structure

```rust
pub struct TranscriptResult {
    pub text: String,
    pub confidence: Option<f32>,  // None if provider doesn't support
    pub is_partial: bool,         // true for interim results
}
```

## Events Emitted to Frontend

### transcript-update

Emitted for each transcription result (partial or final).

```json
{
  "text": "Hello, this is a test",
  "timestamp": "14:30:05",
  "source": "Audio",
  "sequence_id": 42,
  "chunk_start_time": 125.3,
  "is_partial": false,
  "confidence": 0.95,
  "audio_start_time": 125.3,
  "audio_end_time": 128.6,
  "duration": 3.3
}
```

### transcription-error

Emitted when transcription fails.

```json
{
  "error": "Model not loaded",
  "userMessage": "Recording failed: Unable to initialize speech recognition.",
  "actionable": true
}
```

### speech-detected

Emitted once per session when first speech is detected.

```json
{
  "message": "Speech activity detected"
}
```

### transcription-progress

Emitted periodically during transcription.

```json
{
  "worker_id": 0,
  "chunks_completed": 15,
  "chunks_queued": 20,
  "progress_percentage": 75,
  "message": "Worker 0 processing... (15/20)"
}
```

## Audio Format Requirements

- **Sample Rate**: 16000 Hz (16kHz)
- **Channels**: Mono (1 channel)
- **Format**: f32 (32-bit float, normalized -1.0 to 1.0)
- **Chunk Size**: Variable, determined by VAD (Voice Activity Detection)

## Integration Points for New Providers

### 1. Implement TranscriptionProvider trait

Create a new file (e.g., `deepgram_provider.rs`) implementing the trait:

```rust
pub struct DeepgramProvider {
    api_key: String,
    // ... other fields
}

#[async_trait]
impl TranscriptionProvider for DeepgramProvider {
    async fn transcribe(&self, audio: Vec<f32>, language: Option<String>)
        -> Result<TranscriptResult, TranscriptionError> {
        // Implementation
    }
    // ... other methods
}
```

### 2. Register in TranscriptionEngine

Modify `engine.rs` to handle the new provider:

```rust
match config.provider.as_str() {
    "deepgram" => {
        // Initialize and return DeepgramProvider
    }
    // ... existing cases
}
```

### 3. Export in mod.rs

```rust
pub mod deepgram_provider;
pub use deepgram_provider::DeepgramProvider;
```

## Current Providers

| Provider | Config Value | Local/Cloud | GPU Support |
|----------|--------------|-------------|-------------|
| Whisper | `localWhisper` | Local | Metal/CUDA/Vulkan |
| Parakeet | `parakeet` | Local | ONNX Runtime |
| Deepgram | `deepgram` | Cloud (WebSocket) | N/A |

## Configuration Flow

1. User selects provider in Settings UI
2. Frontend calls `api_save_transcript_config()`
3. Config saved to SQLite database
4. On recording start, `get_or_init_transcription_engine()` reads config
5. Appropriate engine is initialized based on `provider` field

## Ciclo de vida del motor STT: carga por sesión, descarga en logout/reposo (sep-2026, #02 de la auditoría de recursos)

> Extraído de CLAUDE.md. Parakeet ya NO se carga al arrancar ni vive para siempre. El `setup()` de `lib.rs` precargaba el modelo STT sin mirar sesión ni registro: 600 MB residentes (652 MB de encoder int8, tres sesiones ORT) en la pantalla de login y en la bandeja sin consumidor posible, y nada lo descargaba jamás (telemetría: 46 MB antes de grabar → 650 MB p50 en reposo para siempre; 11 de 20 usuarios del piloto en 5-7 GB). Piezas, diseñadas juntas:

- **La carga vive en `transcription::ensure_stt_warm(app, reason)`** (`audio/transcription/engine.rs`), gateada por `has_session && registration_completed` (fail-closed, el mismo gate que el embudo de grabación). La disparan la transición None→Some de `set_current_user` (`"login"`), `set_registration_status(true)` para el usuario vivo (`"registration"` — el login pudo llegar con el registro aún desconocido; el frontend lo reinvoca en cada refetch, y por eso es idempotente), el fin de `parakeet_download_model` (`"download_complete"`, cuenta nueva cuyo modelo aún no estaba en disco) y el prewarm de jornada. **No devolver la precarga al `setup()`: era exactamente el hallazgo.**
- **La descarga vive en `transcription::unload_stt(app, reason)`**: `clear_current_user` la llama en logout en TODO tier (sin sesión no hay consumidor); descarga todo motor local que reporte `is_model_loaded()` sin mirar el provider configurado (cubre al que cambió de provider en Ajustes con el viejo residente). **Rehúsa si la fase de grabación no es `Idle`**, incluido `Stopping`: el drenaje final de la cola aún usa el modelo. Si rehúsa no se reintenta ahí.
- **`STT_WARM_LOCK` (`tokio::Mutex`) serializa TRES cosas: la precarga, la carga on-demand de `validate_transcription_model_ready` y el unload, y es siempre el lock más externo.** Sostener el write lock del motor durante el check de fase **NO basta**: `validate` devuelve `Ok` tras un `is_model_loaded()` y suelta todo, y entre ese `Ok` y la primera inferencia pasan cientos de ms en los que un unload que ya pasó su check de fase vacía el modelo y el worker **salta la grabación entera** (chunk sin modelo = chunk descartado). Con el flag `PRELOADED_ENGINE`, la carga y el check de fase bajo el mismo mutex, y `StartGate` (fase `Starting`) adquirido ANTES de que `validate` pida el lock, todos los órdenes terminan bien. `ensure_stt_warm` re-chequea `has_session` DESPUÉS de esperar el lock: un login+logout rápidos no deben recargar lo que el logout acaba de soltar.
- **El fast path `PRELOADED_ENGINE` no comprueba RAM**: se lee y se limpia bajo el lock, y `clear_preloaded()` va **después** de `unload_model()`. Un unload con el flag armado hace que la siguiente grabación salte la carga y muera en `get_or_init_transcription_engine` con "no model loaded".
- **La recarga tras un unload no necesita código nuevo**: tray, scheduler y botón pasan por `initialize_recording` → `validate_transcription_model_ready`, que carga on-demand (3-10 s en fase `Starting`, sin timeout del lado del frontend). Es el riesgo que la auditoría acepta. `recording_lifecycle.rs` sigue dejando el modelo cargado al parar: la política de descarga no vive ahí.
- **Reposo (`transcription/idle_unload.rs`), sólo tier Low**: tarea propia (molde `audio_retention.rs`; el tick del scheduler no sirve porque sólo corre con la jornada habilitada y el usuario manual también merece el ahorro) que descarga tras **10 min continuos en fase `Idle`**, fuera de la ventana de jornada y sin una ventana a menos de 5 min; y **pre-calienta** 5 min antes de la siguiente ventana con un latch de un intento por ventana (si el modelo no está en disco, no se reintenta cada 60 s: `download_complete` ya dispara la carga). El reposo se mide con `Instant`, nunca en ticks (regla del #14). Los settings de jornada se leen del servicio en memoria (`get_settings()`, clone bajo `read()` corto), no de disco. `idle_unload_after(tier)` es la única línea que hay que tocar para cambiar la política; override dev `MAITY_STT_IDLE_UNLOAD_SECS` para el smoke. Fuera de tier Low la tarea retorna sin loop: ahí el modelo sólo se suelta en logout. **Presión de memoria (#22, sep-2026):** con `mem_sampler::pressure_level() >= Elevated` la descarga NO espera el umbral de reposo (`should_unload` acepta `idle_for < threshold` bajo presión), pero conserva los demás guards — en particular el de la ventana a menos de `PREWARM_LEAD`, porque el prewarm la recargaría al tick siguiente.
- **Reciclado drop-then-load, sólo tier Low** (`parakeet_engine.rs::recycle_strategy`): el reciclado periódico (cada 2700 inferencias) cargaba la sesión nueva en una variable local ANTES de soltar la vieja — pico de +700 MB justo cuando Parakeet y FFmpeg más memoria necesitan. En Low se suelta primero bajo el write lock y se carga en `spawn_blocking` con 3 intentos (el worker espera en el lock, la cola mpsc de 256 chunks absorbe; el sleep entre intentos va CON el lock, o el worker saltaría chunks). En Medium/High/Ultra se conserva el swap tras cargar: el pico es inocuo y así un fallo deja la sesión vieja intacta. **Modo de fallo**: si se agotan los intentos, `current_model` queda `None` y `current_model_name` queda `Some` — esa asimetría (un `unload_model` deliberado limpia ambos) es la señal que `worker.rs` usa para alimentar su breaker (`trip_engine_breaker`) y pedir `force_recycle`, sujeto al `min_gap` de 5 min; el evento `stt.engine_lifecycle {reason: recycle_failed, status: error}` se emite una vez por sesión desde el worker. Hasta 5 min sin transcripción es el precio; no se limpia el `min_gap` para reintentar al instante porque reabre la tormenta que existe para evitar.
- **`load_model` de Parakeet tenía un self-deadlock**: `if let Some(cur) = self.current_model_name.read().await.as_ref() { … self.unload_model().await }` — el guard del scrutinee vive todo el bloque y `unload_model` pide el write del mismo lock. Alcanzable sólo al cambiar de modelo A→B desde Ajustes. Snapshot en statement propio, mismo contrato que `SchedulerShared`.
- Telemetría: `stt.engine_lifecycle` (`docs/TELEMETRIA.md`), sólo en cargas/descargas reales; `[METRIC] mem-sample` con etiquetas `stt-warm` / `stt-unload` en el log local.
- Pendiente conocido: `parakeet_validate_model_ready_with_config` devuelve `Ok` con cualquier modelo cargado aunque la config pida otro, y ningún handler de Ajustes llama a `mark_preloaded` pese al comentario de `engine.rs`.
