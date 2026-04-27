use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingPipeline {
    pub id: String,
    pub name: String,
    pub description: String,
    pub stt: SttConfig,
    pub live_feedback: Option<LiveFeedbackConfig>,
    pub analysis_model: String,
    pub analysis_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SttConfig {
    Parakeet,
    Whisper { model: String },
    Moonshine,
    Deepgram { language: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveFeedbackConfig {
    pub model: String,
    pub endpoint: String,
    pub context_window_secs: u32,
    pub interval_secs: u32,
}
