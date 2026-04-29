use super::config::{LiveFeedbackConfig, RecordingPipeline, SttConfig};

pub fn get_default_pipelines() -> Vec<RecordingPipeline> {
    vec![
        RecordingPipeline {
            id: "local_parakeet_gemma".to_string(),
            name: "Local: Parakeet + Qwen".to_string(),
            description: "100% privado. Parakeet para transcripción, Qwen 2.5 para coaching en vivo y análisis. Requiere Coach IA configurado (Ajustes → Pipeline).".to_string(),
            stt: SttConfig::Parakeet,
            live_feedback: Some(LiveFeedbackConfig {
                model: "gemma3-4b-q4".to_string(),
                endpoint: "http://localhost:11436".to_string(),
                context_window_secs: 180,
                interval_secs: 45,
            }),
            analysis_model: "qwen25-7b-q4".to_string(),
            analysis_provider: "ollama".to_string(),
        },
        RecordingPipeline {
            id: "cloud_deepgram_claude".to_string(),
            name: "Cloud: Deepgram + Claude".to_string(),
            description: "Transcripción en tiempo real con Deepgram Nova-3, análisis profundo con Claude Sonnet. Requiere cuenta Maity activa.".to_string(),
            stt: SttConfig::Deepgram {
                language: "es-419".to_string(),
            },
            live_feedback: None,
            analysis_model: "claude-sonnet-4-6".to_string(),
            analysis_provider: "claude".to_string(),
        },
        RecordingPipeline {
            id: "local_whisper_ollama".to_string(),
            name: "Local: Whisper + Ollama".to_string(),
            description: "100% privado. Whisper para transcripción precisa multi-idioma, Qwen para análisis. Más lento al iniciar que Parakeet.".to_string(),
            stt: SttConfig::Whisper {
                model: "base".to_string(),
            },
            live_feedback: Some(LiveFeedbackConfig {
                model: "gemma3-4b-q4".to_string(),
                endpoint: "http://localhost:11436".to_string(),
                context_window_secs: 180,
                interval_secs: 45,
            }),
            analysis_model: "qwen25-7b-q4".to_string(),
            analysis_provider: "ollama".to_string(),
        },
    ]
}
