//! Canary-1B-Flash (NVIDIA NeMo) speech recognition engine module.
//!
//! Encoder-decoder architecture with autoregressive decoding.
//! Better Spanish accuracy than Parakeet (2.69% WER MLS vs 3.45% FLEURS).
//!
//! # Architecture
//!
//! - **Encoder**: Conformer encoder (859MB int8)
//! - **Decoder**: Autoregressive transformer decoder (79.5MB int8)
//! - **Preprocessing**: Log-mel spectrogram computed in Rust (no ONNX preprocessor)
//! - **Languages**: en, es, de, fr (with task tokens)

pub mod canary_engine;
pub mod model;
pub mod preprocessor;
pub mod commands;

pub use canary_engine::{CanaryEngine, CanaryEngineError, ModelInfo, ModelStatus, DownloadProgress};
pub use model::{CanaryModel, CanaryError};
pub use commands::*;
