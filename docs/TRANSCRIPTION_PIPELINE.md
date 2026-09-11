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

### Transcripción por lote (F1 de la migración, sep-2026)

`audio/transcription/batch/` transcribe una grabación YA en disco (decoder ffmpeg por canal → compuerta de energía sin Silero → chunks de 10-30 s → Parakeet) y escribe el MISMO `transcripts.json` del streaming — la serialización está compartida en `recording_saver::write_transcripts_atomic` para que el shape que consume `finalize_segment_native` no pueda divergir. Reglas nuevas del ciclo STT que introduce:

- **`ensure_stt_warm_parakeet(app, reason)`**: warm forzado a Parakeet (el lote SIEMPRE es Parakeet local por decisión de producto; el provider configurado puede ser Deepgram). Mismos gates fail-closed de sesión/registro y mismo `STT_WARM_LOCK`.
- **`BatchSttLease` (guard RAII, contador `BATCH_STT_LEASE` en `engine.rs`)**: un job de lote usa el motor con fase de grabación `Idle`, así que la fase ya no es señal suficiente de "en uso". `unload_stt` rehúsa con lease vivo (`UnloadOutcome::RefusedBatchLease`), chequeado BAJO `STT_WARM_LOCK`; `idle_unload::should_unload` lo recibe como input (`batch_lease`) y ni lo intenta — incluso bajo presión `Critical`, porque descargar a mitad de una inferencia pierde el chunk. El guard se suelta por Drop también en error.
- **La inferencia del lote corre en `spawn_blocking`** (`transcriber.rs::transcribe_chunk`): `Handle::block_on` en un hilo del blocking pool ejecuta el cómputo ONNX fuera de los workers async (avance del hallazgo #16 para este pipeline).
- **En F1 el único entrypoint es el comando dev `batch_transcribe_folder(folderPath)`** (consola de DevTools), que escribe `transcripts.batch.json` AL LADO del de streaming (nunca lo pisa) y devuelve métricas `{audioSecs, voicedSecs, wallMs, rtf, segments, words, discardedHallucinations}` — el instrumento para medir WER sobre AAC 64k y RTF antes del flip.
- Convención de canales fija: L = mic = `source_type:"user"`, R = sistema = `"interlocutor"` (strings exactos del worker). El decode usa el filtro `pan` (no `-map_channel`, retirado en ffmpeg 7+); `decode_args` tiene golden test.

### Cola persistente y planificador híbrido (F2)

- **`batch_transcription_queue`** (migración aditiva `20260909000000`): la fila nace al ARRANCAR el segmento (`status='recording'`) — patrón outbox como `sync_queue`, así la recuperación post-crash vive en Rust. Estados: `recording → pending → processing → done|discarded|failed`; `trigger_kind`: `manual|rotation|auto_close|crash_recovery`; `process_id` (migración aditiva `20260911100000`): `process_session_id()` del proceso que graba, re-sellado en cada upsert — es el discriminador de huérfanos (`NULL` = build anterior = huérfana). **Las filas terminales se CONSERVAN** (paridad con la regla #26). Repo: `database/repositories/batch_queue.rs` (claim con mutex `AND status='pending'`, `fail` con reintentos hasta 5 — **solo toca `processing`** —, `fail_recovery` para el merge sobre `recording`, `fail_permanent` sin quemar intentos).
- **`batch/planner.rs`**: tarea propia arrancada en `lib.rs` junto a `audio_retention` (delay 120 s); disparadores: `notify_enqueued()` al encolar (F3), tick de reintento de 5 min y `request_drain()` (fin de jornada / arranque con backlog). **Single-flight**: el loop es el único consumidor.
- **Gate híbrido (`gate()`, política pura tabulada)**: toma job solo con `pressure_level()==Normal` && `avail > headroom` (`BATCH_HEADROOM_MB`=1800 frío / 400 con Parakeet residente — **calibrar con F0c**) && CPU <80 %. Con grabación STREAMING activa difiere siempre (`streaming_active`); con grabación en modo lote no bloquea. En **drain** solo `Critical` difiere. Diferir NO quema `attempts`; emite `stt.batch_deferred` con latch por episodio.
- **Recuperación de huérfanos (`recover_orphans`, 2026-09-11)**: corre al arranque (+120 s) **y en cada despertar del loop** (notify / tick de 5 min) antes de `process_queue`, en la misma task. `processing` abandonado → `pending` solo al arranque. Una fila `recording` es huérfana (`is_orphan`, pura, tabulada) si su `process_id` no es el del proceso actual o si es el nuestro pero la fase ya es `Idle` (stop fallido antes de `mark_pending`). La fila VIVA nunca califica: se inserta tras `start_gate.commit()` y `mark_pending` precede a `drop(stop_gate)`, así que la fase leída **después** del SELECT la protege; en la rotación (finalize ≤300 s, fase `Stopping`) lleva nuestro pid. Orden checkpoints-first (`recovery_action`): con `.checkpoints/*.mp4` se re-fusiona SIEMPRE (`-y` sobreescribe un `audio.mp4` truncado por un corte a mitad del concat); sin checkpoints y con `audio.mp4` → recuperada; ninguno → `failed` (`recovery_none`); carpeta desaparecida → `failed` (`folder_missing`). Recuperada = `pending` con `last_error='crash_recovery'`, `trigger_kind` de origen intacto y `attempts=0`. Error del merge → `fail_recovery` (reintento en `recording` hasta 5 pasadas, luego `failed` visible con Reintentar) — **nunca `fail`**, cuya guarda `status='processing'` no toca filas `recording` (así quedaban invisibles para siempre). **No volver a posponer la pasada "porque hay grabación activa"**: con jornada + arranque automático siempre hay grabación a los 120 s y el segmento del día anterior se quedaba `recording` indefinidamente. Con backlog pendiente → drain.
- **`unload_allowed(phase, recording_uses_stt)`** (`engine.rs`): nueva señal `ACTIVE_RECORDING_USES_STT` (default `true` = streaming). En modo lote la grabación no consume el motor, así que `Recording/Paused/Stopping` dejan de bloquear el unload. La setea el arranque de grabación en F3; al vaciar la cola el planner llama `unload_stt(app, "batch_done")` (#02).
- Telemetría: `stt.batch_job` (una fila por job terminal) y `stt.batch_deferred` (latch) — ver `docs/TELEMETRIA.md`.

### Disparadores cableados (F3; default sigue streaming)

- **`RecordingPreferences.transcription_mode`** (`"streaming"` default hasta F6; aditivo con `#[serde(default)]`): `is_batch_mode()` es el único punto de decisión. Sin `auto_save` no hay checkpoints → la combinación lote+sin-guardado cae a streaming.
- **Arranque en lote** (`initialize_recording`): NO valida el motor STT (la carga es del planner), `RecordingManager.transcription_enabled=false` → el pipeline NO construye Silero (`AudioPipeline` con VAD `Option`, STEP 1 saltado; STEP 2 —grabación stereo/checkpoints— intacto), NO se spawnea worker ni transcript-listener; se setea `uses_stt=false` y la fila de la cola nace con la grabación (`upsert_recording`, trigger según origen: `manual` o `rotation`).
- **Stop (todos los caminos pasan por `stop_recording_reporting`)**: restaura `uses_stt=true`, `mark_pending` + `notify_enqueued()` + evento `batch-transcription-status {pending}`. El payload de `recording-stop-complete` sigue siendo el booleano de siempre (extenderlo rompería al listener actual del provider; el meetingId del lote viaja por el evento nuevo cuando llega a `ready`).
- **Scheduler**: en lote `rotate`/`close_scheduled` NO llaman `finalize_segment_native` (el transcripts.json aún no existe); emiten sus eventos con `batch: true` y `meetingId: null`, y el cierre de jornada pide `request_drain()`. `finalize_segment_native` ganó el flag `enforce_min_words` y es `pub(crate)`: el planner lo invoca al terminar cada job — jornada aplica `MIN_SEGMENT_WORDS`, **manual nunca descarta** (por eso `mark_crash_recovery` CONSERVA el `trigger_kind` de origen; la marca de recuperación va en `last_error`).
- **`idle_unload`**: en modo lote el prewarm pre-jornada no aplica (`should_prewarm` con `batch_mode` — cargar el motor antes de la ventana serían 600 MB sin consumidor).
- Evento gemelo nuevo `batch-transcription-status` (`events.rs` + `lib/tauri-events.ts`): `pending → processing → ready(meetingId) | discarded | failed`. La UI lo consume en F4; el placeholder de `meetings` con `transcription_status` se movió a F4 (sin UI que lo explique, una reunión vacía en la lista local-first parecería rota) — y F4 acabó descartándolo (abajo).

### Frontend del lote (F4)

No hay columna `transcription_status` ni reunión placeholder: **la cola `batch_transcription_queue` es la fuente de verdad y el webview solo la proyecta** (una columna obligaría a que `save_transcript` hiciera UPDATE, cambiaría la semántica de `localId` y sumaría version-skew; la cola ya guarda carpeta, trigger, estado, intentos y error, y conserva filas terminales). Contrato congelado Rust ↔ TS:

- **El modo llega al frontend por dos vías aditivas.** `recording-stopped` (objeto) lleva `transcription_mode: "streaming"|"batch"` (derivado de `was_batch` en `recording_lifecycle.rs`) y `get_recording_state` lleva `transcription_mode` (derivado de `manager.transcription_enabled`): el `RecordingStateProvider` ya hace poll cada 500 ms y sync al montar, así cubre arranque y recarga del webview a mitad de grabación. `recording-stop-complete` sigue siendo el booleano histórico (se emite desde 5 sitios; `useRecordingStop` no puede ramificar por él).
- **`batch-transcription-status` gana el campo aditivo `trigger`** (`manual|rotation|auto_close|crash_recovery`; los 5 `emit_status` del planner lo pasan). Payload TS `BatchTranscriptionStatusPayload {meetingId, folderPath, status, trigger?}`; `meetingId` solo existe en `ready`. Solo sirve para textos y para decidir si se navega.
- **Comandos** (`database/batch_queue_commands.rs`, molde `sync_queue_commands.rs`; sin entrada en capabilities, son comandos custom): `batch_queue_list_active() -> Vec<{id, folder_path, meeting_name, trigger_kind, status, attempts, last_error, segment_started_at, updated_at}>` (snake_case; status IN pending|processing|failed del usuario actual, `ORDER BY id DESC LIMIT 50`; **excluye `recording`**: una fila stale de un crash se vería como "Grabando" hasta la pasada de recovery) y `batch_queue_retry(folderPath) -> bool` (`failed → pending`, `attempts=0`, `last_error=NULL`, + `planner::notify_enqueued()`; no toca pending/processing). `meeting_name` sale de `planner::read_meeting_name`.
- **Keys de `sessionStorage`.** `last_recording_transcription_mode`: la escribe el listener de `recording-stopped` **incondicionalmente en cada stop** (`payload.transcription_mode ?? 'streaming'`) — una key `batch` rancia haría que un stop streaming saltara `saveMeeting` = pérdida de datos; la lee `handleRecordingStop` para ramificar y la limpian las tres ramas (`STOP_SESSION_KEYS`). `batch_pending_navigation = folderPath`: la carpeta que el usuario acaba de parar; el provider la compara con el `folderPath` del `ready` para navegar al detalle (`/conversations?localId=…&source=recording`) solo si seguimos en `/conversations` sin `localId|id`; si no, toast "Transcripción lista → Ver" + `sendNativeNotification`. Jornada (`rotation|auto_close|crash_recovery`): silenciosa, la lista se invalida por el bus DOM. En `ready` manual además `feedback_pending_meeting_id = meetingId`.
- **Stop en lote (`useRecordingStop`)**: tras esperar `recording-stopped` y ANTES de `flushBuffer`: `markMeetingAsSaved()`, limpiar keys, `clearTranscripts()`, `setIsMeetingActive(false)`, `setStatus(IDLE)`, `setIsRecordingDisabled(false)` (el `return` temprano se salta el reset del final de la función), toast "Grabación guardada — se transcribirá al terminar" y **soft `router.push('/conversations')`** — no `window.location.href`: en lote no hay STT/sidecar que envenene el estado y el provider debe seguir vivo para recibir `processing/ready`. NUNCA `saveMeeting`, `has_audio_checkpoints`/`recover_audio_from_checkpoints` ni `enqueueCloudSync`: Rust guarda (`finalize_segment_native` al terminar el job) y encola el sync. Hasta F4, en lote el stop caía a la rama "0 transcripts": mezclaba checkpoints por duplicado y mostraba "Reunión sin transcripción".
- **Evento DOM `batch-transcription-status-changed`** (`CustomEvent`, `detail` = payload Tauri): lo despacha `RecordingPostProcessingProvider` (patrón `sync-status-changed`); `PendingTranscriptionsBlock` invalida `['batch-queue-active']` y, en `ready|discarded`, también `['local-conversations']`; `failed` → `toast.error` con acción "Abrir carpeta" (`reveal_in_folder`). Los payloads de rotate/close del scheduler llevan `batch?: boolean` → `meetingId || discarded || batch` ⇒ `markMeetingAsSaved()`.
- **Regla de propiedad de IndexedDB**: en lote el registro WAL nace con `transcriptionMode:'batch'` (`TranscriptContext` lo lee de `get_recording_state`; sin bump de `DB_VERSION`) y `useTranscriptRecovery` lo borra como fantasma **SIEMPRE** (`transcriptCount===0 || transcriptionMode==='batch'`), tenga o no transcripts. Excluirlo del filtro (lo que decía el plan) lo empujaba a `recentMeetings` → `has_audio_checkpoints` → diálogo de recuperación → `recoverMeeting` falla con "No transcripts found". **La cola Rust es la dueña de la recuperación** (`crash_recovery` del planner); el webview nunca reconstruye una grabación en lote.
- UI: select "Modo de transcripción" en `RecordingSettings` (solo `isAdmin && roleKnown`; único escritor `savePreferences` porque `set_recording_preferences` reemplaza el objeto entero; aviso ámbar si `!auto_save && batch`; "Aplica a la siguiente grabación"); bloque "Transcripciones pendientes" al inicio de `ConversationsList` (`pending` → "Pendiente de transcribir" + "reintento N" si `attempts>0` — `processing→pending` ocurre en reintentos; `processing` → "Transcribiendo…"; `failed` → "No se pudo transcribir" + `title={last_error}` + Reintentar; origen Manual / Jornada / Recuperada por `last_error==='crash_recovery'`; `refetchInterval` 15 s con no-terminales); `TranscriptPanel` monta `BatchRecordingHero` en lugar de la vista en vivo (desde sep-2026: temporizador + barras por canal desde `audioLevelsStore` + Ritmo y anillo de tiempo de palabra desde `meeting-metrics`, que en modo audio trae además `userVoicedSecs`/`interlocutorVoicedSecs` aditivos + último tip; antes sólo decía "Transcribiendo al finalizar la grabación" y la pantalla quedaba vacía; reglas en `docs/UI_REGLAS.md` § "Pantalla de grabación en lote"). Sin telemetría nueva ni `recordingLogService.log` en la rama de lote (el lint exige literales del catálogo).

**Ajustes tras la refutación (2026-09-09):** (1) el stop del frontend ya no decide por `sessionStorage`: *deferred* por sesión creado en `recording-started` y resuelto por `recording-stopped` (`{folderPath, transcriptionMode}`, race de 3 s → streaming); por eso **todo arranque de sesión debe emitir `recording-started`**. (2) El scheduler resuelve "este segmento es lote" con el modo SELLADO de la sesión (`recording_lifecycle::active_session_transcription_mode()`, leído antes de parar; política pura `segment_is_batch` en `service.rs`), no releyendo preferencias — con lote+`auto_save=false` el segmento grabó en streaming y debe finalizarse como tal. (3) `segment_started_at` de la cola es hora LOCAL naive; `updated_at` es UTC.
