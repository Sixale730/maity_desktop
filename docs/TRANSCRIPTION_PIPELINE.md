# Pipeline de Transcripcion

## Descripcion General

Este documento describe el pipeline de transcripcion de Maity Desktop, desde la captura de audio hasta la emision de eventos al frontend. El sistema utiliza exclusivamente proveedores de transcripcion locales basados en ONNX Runtime: **Parakeet** (TDT transducer, por defecto) y **Canary** (encoder-decoder, opcional). No se utiliza ningun servicio de transcripcion en la nube.

## Diagrama de Arquitectura

```
                    +------------------+
                    |   Usuario hace   |
                    | clic en Grabar   |
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
|              Capa de Comandos Tauri                    |
|  - lib.rs: comando start_recording                    |
|  - recording_commands.rs: orquestacion                |
+---------------------------+---------------------------+
                             |
                             v
+---------------------------+---------------------------+
|                 Capa de Captura de Audio               |
|  +---------------+    +------------------+            |
|  | Microfono     |    | Audio del        |            |
|  | (cpal)        |    | Sistema          |            |
|  | microphone.rs |    | (WASAPI/CoreAudio)|           |
|  +-------+-------+    +--------+---------+            |
|          |                     |                      |
|          +----------+----------+                      |
|                     |                                 |
|                     v                                 |
|            +--------+--------+                        |
|            | Audio Pipeline  |                        |
|            | (pipeline.rs)   |                        |
|            | - Mezcla stereo |                        |
|            |   (L=mic,       |                        |
|            |    R=sistema)   |                        |
|            | - VAD dual-canal|                        |
|            |   (mic_vad,     |                        |
|            |    sys_vad)     |                        |
|            | - Chunking      |                        |
|            +--------+--------+                        |
+---------------------------+---------------------------+
                             |
                             | AudioChunk (tokio channel)
                             | (con DeviceType: Microphone|System)
                             v
+---------------------------+---------------------------+
|              Capa de Transcripcion                     |
|  +-------------------------------+                    |
|  | worker.rs                     |                    |
|  | - Recibe chunks por canal     |                    |
|  | - ChunkAccumulator por        |                    |
|  |   dispositivo (mic/sistema)   |                    |
|  | - Workers paralelos           |                    |
|  +---------------+---------------+                    |
|                  |                                    |
|                  v                                    |
|  +---------------+---------------+                    |
|  | TranscriptionEngine           |                    |
|  | (engine.rs)                   |                    |
|  | - Lee config de SQLite        |                    |
|  | - Inicializa proveedor        |                    |
|  +---------------+---------------+                    |
|                  |                                    |
|         +--------+--------+                           |
|         |                 |                           |
|         v                 v                           |
|  +-----------+     +-----------+                      |
|  | Parakeet  |     | Canary    |                      |
|  | ONNX TDT  |     | ONNX Enc- |                      |
|  | (defecto) |     | Decoder   |                      |
|  +-----------+     +-----------+                      |
+---------------------------+---------------------------+
                             |
                             | app.emit()
                             v
+---------------------------+---------------------------+
|                  Emision de Eventos                    |
|  - "transcript-update"     (transcripcion nueva)      |
|  - "transcription-error"   (error del motor)          |
|  - "speech-detected"       (primera voz detectada)    |
|  - "transcription-progress"(progreso de chunks)       |
+---------------------------+---------------------------+
                             |
                             | Bus de Eventos Tauri
                             v
+---------------------------+---------------------------+
|                  Listeners del Frontend                |
|  - transcriptService.ts   (servicio de escucha)       |
|  - TranscriptView.tsx      (visualizacion UI)         |
|  - RecordingControls.tsx   (estado de grabacion)      |
+---------------------------+---------------------------+
```

## Archivos Clave

### Captura de Audio

| Archivo | Ubicacion | Proposito |
|---------|-----------|-----------|
| `recording_commands.rs` | `src-tauri/src/audio/` | Comandos Tauri para iniciar/detener grabacion |
| `recording_manager.rs` | `src-tauri/src/audio/` | Orquestacion del ciclo de vida de grabacion |
| `pipeline.rs` | `src-tauri/src/audio/` | Mezcla stereo (L=mic, R=sistema), VAD dual-canal y distribucion de audio |
| `microphone.rs` | `src-tauri/src/audio/capture/` | Captura de microfono via cpal |
| `system.rs` | `src-tauri/src/audio/capture/` | Captura de audio del sistema (WASAPI en Windows, CoreAudio en macOS) |

### Transcripcion

| Archivo | Ubicacion | Proposito |
|---------|-----------|-----------|
| `provider.rs` | `src-tauri/src/audio/transcription/` | Definicion del trait `TranscriptionProvider` |
| `engine.rs` | `src-tauri/src/audio/transcription/` | Enum `TranscriptionEngine`, inicializacion y seleccion de proveedor |
| `worker.rs` | `src-tauri/src/audio/transcription/` | Pool de workers paralelos, `ChunkAccumulator` y emision de eventos |
| `parakeet_provider.rs` | `src-tauri/src/audio/transcription/` | Implementacion de Parakeet (ONNX TDT transducer) |
| `canary_provider.rs` | `src-tauri/src/audio/transcription/` | Implementacion de Canary (ONNX encoder-decoder autoregresivo) |

### Configuracion

| Archivo | Ubicacion | Proposito |
|---------|-----------|-----------|
| `api.rs` | `src-tauri/src/api/` | Struct `TranscriptConfig` y llamadas API para leer/guardar configuracion |
| `lib.rs` | `src-tauri/src/` | Inicializacion de la app Tauri, registro de comandos, migracion de proveedores |
| `ConfigContext.tsx` | `src/context/` | Estado React para configuracion de transcripcion |
| `TranscriptSettings.tsx` | `src/components/` | UI de seleccion de proveedor de transcripcion |

## Trait TranscriptionProvider

Todos los proveedores de transcripcion implementan este trait unificado definido en `provider.rs`:

```rust
/// Tipos de error granulares para operaciones de transcripcion
#[derive(Debug, Clone)]
pub enum TranscriptionError {
    ModelNotLoaded,
    AudioTooShort { samples: usize, minimum: usize },
    EngineFailed(String),
    UnsupportedLanguage(String),
}

/// Trait para proveedores de transcripcion (Parakeet, Canary, futuros proveedores)
#[async_trait]
pub trait TranscriptionProvider: Send + Sync {
    /// Transcribir muestras de audio a texto
    ///
    /// # Argumentos
    /// * `audio` - Muestras de audio (16kHz mono, formato f32)
    /// * `language` - Indicacion de idioma opcional (e.g., "en", "es", "fr")
    ///
    /// # Retorna
    /// * `TranscriptResult` con texto, confianza opcional y flag de parcialidad
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError>;

    /// Verificar si hay un modelo cargado actualmente
    async fn is_model_loaded(&self) -> bool;

    /// Obtener el nombre del modelo cargado actualmente
    async fn get_current_model(&self) -> Option<String>;

    /// Obtener el nombre del proveedor (para logging/depuracion)
    fn provider_name(&self) -> &'static str;
}
```

## Estructura TranscriptResult

Resultado unificado de transcripcion devuelto por todos los proveedores:

```rust
/// Resultado de transcripcion unificado entre todos los proveedores
#[derive(Debug, Clone)]
pub struct TranscriptResult {
    pub text: String,              // Texto transcrito
    pub confidence: Option<f32>,   // None si el proveedor no soporta puntajes de confianza
    pub is_partial: bool,          // true para resultados intermedios (no finales)
}
```

## Estructura TranscriptUpdate (Evento al Frontend)

Estructura serializada emitida al frontend via el evento `transcript-update`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptUpdate {
    pub text: String,                    // Texto transcrito
    pub timestamp: String,               // Hora de reloj para referencia (e.g., "14:30:05")
    pub source: String,                  // Fuente del audio (e.g., "Audio")
    pub sequence_id: u64,                // ID secuencial unico
    pub chunk_start_time: f64,           // Campo legacy, mantenido por compatibilidad
    pub is_partial: bool,                // true si es resultado parcial
    pub confidence: f32,                 // Confianza (0.85 por defecto si no disponible)
    pub audio_start_time: f64,           // Segundos desde inicio de grabacion
    pub audio_end_time: f64,             // Segundos desde inicio de grabacion
    pub duration: f64,                   // Duracion del segmento en segundos
    pub source_type: Option<String>,     // "user" (microfono) o "interlocutor" (sistema)
}
```

## Eventos Emitidos al Frontend

### transcript-update

Se emite para cada resultado de transcripcion (parcial o final). Es el evento principal del pipeline.

```json
{
  "text": "Hola, esta es una prueba de transcripcion",
  "timestamp": "14:30:05",
  "source": "Audio",
  "sequence_id": 42,
  "chunk_start_time": 125.3,
  "is_partial": false,
  "confidence": 0.85,
  "audio_start_time": 125.3,
  "audio_end_time": 128.6,
  "duration": 3.3,
  "source_type": "user"
}
```

**Campos de identificacion de hablante**:
- `source_type: "user"` - Audio proveniente del microfono (el usuario local).
- `source_type: "interlocutor"` - Audio proveniente del sistema (la otra persona en la llamada).
- `source_type: null` - Audio mezclado (no se puede determinar la fuente).

### transcription-error

Se emite cuando la transcripcion falla. Incluye un mensaje legible para el usuario.

```json
{
  "error": "No transcription model is loaded",
  "userMessage": "Recording failed: Unable to initialize speech recognition. Please check your model settings.",
  "actionable": true
}
```

### speech-detected

Se emite **una sola vez por sesion** de grabacion cuando se detecta la primera actividad de voz. Util para actualizar la UI indicando que el pipeline esta funcionando.

```json
{
  "message": "Speech activity detected"
}
```

### transcription-progress

Se emite periodicamente durante la transcripcion para informar el progreso de procesamiento de chunks.

```json
{
  "worker_id": 0,
  "chunks_completed": 15,
  "chunks_queued": 20,
  "progress_percentage": 75,
  "message": "Worker 0 processing... (15/20)"
}
```

### transcription-summary

Se emite al finalizar la grabacion con metricas finales del pipeline.

```json
{
  "chunks_queued": 45,
  "chunks_completed": 45,
  "chunks_dropped": 0,
  "loss_percentage": 0.0,
  "status": "success"
}
```

## Requisitos de Formato de Audio

El motor de transcripcion espera audio en el siguiente formato:

| Parametro | Valor | Notas |
|-----------|-------|-------|
| Frecuencia de muestreo | 16000 Hz (16kHz) | El pipeline remuestrea automaticamente si el audio llega a otra frecuencia |
| Canales | Mono (1 canal) | El pipeline extrae el canal apropiado (mic o sistema) antes de enviar |
| Formato | f32 | Punto flotante de 32 bits, normalizado entre -1.0 y 1.0 |
| Tamano de chunk | Variable | Determinado por VAD (Voice Activity Detection), tipicamente 0.5-8 segundos |

**Nota sobre ChunkAccumulator**: Los segmentos cortos del VAD (e.g., 400ms) se acumulan en chunks mas grandes (3-8 segundos) antes de enviarse al motor de transcripcion. Esto reduce la sobrecarga de inicializacion por chunk y mejora la calidad de transcripcion. Los parametros se adaptan automaticamente segun el perfil de hardware:

| Tier de rendimiento | Duracion minima | Duracion maxima | Timeout de flush |
|---------------------|-----------------|-----------------|------------------|
| Ultra | 1.0s | 8.0s | 1500ms |
| High | 0.8s | 6.0s | 1200ms |
| Medium | 0.8s | 4.0s | 1000ms |
| Low | 0.5s | 3.0s | 800ms |

## Proveedores Actuales

| Proveedor | Valor de Config | Local/Nube | Modelo por Defecto | Tamano | Aceleracion |
|-----------|-----------------|------------|---------------------|--------|-------------|
| Parakeet | `parakeet` | Local | `parakeet-tdt-0.6b-v3-int8` | 670MB | ONNX Runtime (CPU) |
| Canary | `canary` | Local | `canary-1b-flash-int8` | 939MB | ONNX Runtime (CPU) |

**Nota**: Whisper esta deshabilitado. Su codigo permanece en el repositorio pero no se inicializa al arrancar la aplicacion. La configuracion `localWhisper` en la base de datos se migra automaticamente a `parakeet` al iniciar.

### Comparacion de Proveedores

| Caracteristica | Parakeet | Canary |
|---------------|----------|--------|
| Arquitectura | TDT (Token-and-Duration Transducer) | Encoder-Decoder (autoregresivo) |
| WER Espanol | 3.45% | 2.69% (MLS) |
| Idiomas | Ingles + Espanol | en, es, de, fr |
| Inicializacion | Incondicional al arrancar | Solo si esta seleccionado en config |
| Preprocesamiento | ONNX preprocessor | Log-mel spectrogram en Rust (rustfft) |
| Decodificacion | Transducer (no autoregresivo) | Greedy decoding, max 256 tokens |

## Flujo de Configuracion

El flujo completo para la seleccion y uso del proveedor de transcripcion es:

1. **Seleccion por el usuario**: El usuario abre Configuracion y selecciona un proveedor de transcripcion (Parakeet o Canary) en la UI de `TranscriptSettings.tsx`.

2. **Guardado en base de datos**: El frontend invoca `api_save_transcript_config()` que guarda la configuracion (proveedor + modelo) en la tabla de settings de SQLite via `SettingsRepository::save_transcript_config()`.

3. **Lectura al iniciar grabacion**: Cuando el usuario hace clic en "Grabar", el sistema llama a `validate_transcription_model_ready()` en `engine.rs`, que:
   - Lee la configuracion de transcripcion desde SQLite via `api_get_transcript_config()`.
   - Si no hay configuracion guardada, usa el fallback por defecto: `parakeet` / `parakeet-tdt-0.6b-v3-int8`.
   - Si la configuracion dice `localWhisper`, la migra automaticamente a `parakeet`.

4. **Inicializacion del motor**: `get_or_init_transcription_engine()` inicializa el proveedor apropiado:
   - Para `parakeet`: Obtiene la instancia global `PARAKEET_ENGINE` (ya inicializada al arrancar la app).
   - Para `canary`: Obtiene la instancia global `CANARY_ENGINE` (inicializada solo si fue seleccionado).
   - Para cualquier otro valor: Fallback a Parakeet.

5. **Transcripcion activa**: El motor seleccionado se pasa al pool de workers en `worker.rs`, que procesa los chunks de audio durante toda la sesion de grabacion.

6. **Emision de resultados**: Cada transcripcion exitosa se emite al frontend como evento `transcript-update` con el texto, timestamps relativos a la grabacion y tipo de fuente (`"user"` o `"interlocutor"`).
