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
