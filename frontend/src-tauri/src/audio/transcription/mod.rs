// audio/transcription/mod.rs
//
// Transcription module: Provider abstraction, engine management, and worker pool.

pub mod provider;
pub mod whisper_provider;
pub mod parakeet_provider;
pub mod deepgram_provider;  // Deepgram cloud transcription
pub mod deepgram_commands;  // Tauri commands for Deepgram cloud proxy tokens
pub mod engine;
pub mod worker;
pub mod spanish_postprocess;  // Heuristic post-processor for Spanish transcripts

// Re-export commonly used types
pub use provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
pub use whisper_provider::WhisperProvider;
pub use parakeet_provider::ParakeetProvider;
pub use deepgram_provider::{DeepgramRealtimeTranscriber, DeepgramConfig};
pub use deepgram_commands::{
    set_deepgram_proxy_config,
    get_deepgram_proxy_config,
    has_valid_deepgram_proxy_config,
    clear_deepgram_proxy_config,
    get_cached_proxy_config,
    has_cached_proxy_config,
};
pub use engine::{
    TranscriptionEngine,
    validate_transcription_model_ready,
    preload_transcription_engine,
    get_or_init_transcription_engine,
    get_or_init_whisper
};
pub use worker::{
    start_transcription_task,
    reset_speech_detected_flag,
    TranscriptUpdate
};
