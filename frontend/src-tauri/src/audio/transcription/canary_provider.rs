// audio/transcription/canary_provider.rs
//
// Canary transcription provider implementation.

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use std::sync::Arc;

/// Canary transcription provider (wraps CanaryEngine)
pub struct CanaryProvider {
    engine: Arc<crate::canary_engine::CanaryEngine>,
}

impl CanaryProvider {
    pub fn new(engine: Arc<crate::canary_engine::CanaryEngine>) -> Self {
        Self { engine }
    }
}

#[async_trait]
impl TranscriptionProvider for CanaryProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        // Canary supports language hints: es, en, de, fr
        match self.engine.transcribe_audio_with_lang(audio, language).await {
            Ok(text) => Ok(TranscriptResult {
                text: text.trim().to_string(),
                confidence: None,
                is_partial: false,
            }),
            Err(e) => Err(TranscriptionError::EngineFailed(e.to_string())),
        }
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_model_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.get_current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "Canary"
    }
}
