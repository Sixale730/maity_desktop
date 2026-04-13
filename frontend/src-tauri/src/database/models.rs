use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingModel {
    pub id: String,
    pub title: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub folder_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(transparent)]
pub struct DateTimeUtc(pub DateTime<Utc>);

impl From<NaiveDateTime> for DateTimeUtc {
    fn from(naive: NaiveDateTime) -> Self {
        DateTimeUtc(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
    }
}

// Renamed from TranscriptSegment to Transcript to match the table name
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Transcript {
    pub id: String,
    pub meeting_id: String,
    pub transcript: String,
    pub timestamp: String,
    pub summary: Option<String>,
    pub action_items: Option<String>,
    pub key_points: Option<String>,
    // Recording-relative timestamps for audio-transcript synchronization
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
    // Speaker identification: "user" (microphone) or "interlocutor" (system audio)
    pub speaker: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SummaryProcess {
    pub meeting_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub error: Option<String>,
    pub result: Option<String>, // JSON
    pub start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub chunk_count: i64,
    pub processing_time: f64,
    pub metadata: Option<String>, // JSON
    pub result_backup: Option<String>, // Backup of result before regeneration
    pub result_backup_timestamp: Option<chrono::DateTime<chrono::Utc>>, // When backup was created
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptChunk {
    pub meeting_id: String,
    pub meeting_name: Option<String>,
    pub transcript_text: String,
    pub model: String,
    pub model_name: String,
    pub chunk_size: Option<i64>,
    pub overlap: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Setting {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[sqlx(rename = "whisperModel")]
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[sqlx(rename = "groqApiKey")]
    #[serde(rename = "groqApiKey")]
    pub groq_api_key: Option<String>,
    #[sqlx(rename = "openaiApiKey")]
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: Option<String>,
    #[sqlx(rename = "anthropicApiKey")]
    #[serde(rename = "anthropicApiKey")]
    pub anthropic_api_key: Option<String>,
    #[sqlx(rename = "ollamaApiKey")]
    #[serde(rename = "ollamaApiKey")]
    pub ollama_api_key: Option<String>,
    #[sqlx(rename = "openRouterApiKey")]
    #[serde(rename = "openRouterApiKey")]
    pub open_router_api_key: Option<String>,
    #[sqlx(rename = "ollamaEndpoint")]
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
    /// Custom OpenAI-compatible endpoint configuration stored as JSON
    #[sqlx(rename = "customOpenAIConfig")]
    #[serde(rename = "customOpenAIConfig")]
    pub custom_openai_config: Option<String>,
}

impl Setting {
    /// Parse the custom OpenAI config from JSON string
    pub fn get_custom_openai_config(&self) -> Option<crate::summary::CustomOpenAIConfig> {
        self.custom_openai_config.as_ref().and_then(|json| {
            serde_json::from_str(json).ok()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_datetime_utc_serialization() {
        let now = Utc::now();
        let dt_utc = DateTimeUtc(now);

        let json = serde_json::to_string(&dt_utc).expect("serialization failed");
        let deserialized: DateTimeUtc =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(dt_utc.0.timestamp(), deserialized.0.timestamp());
    }

    #[test]
    fn test_datetime_utc_from_naive_datetime() {
        use chrono::NaiveDateTime;

        let naive = NaiveDateTime::from_timestamp_opt(1000000000, 0).expect("invalid timestamp");
        let dt_utc = DateTimeUtc::from(naive);

        assert_eq!(dt_utc.0.timestamp(), 1000000000);
    }

    #[test]
    fn test_meeting_model_serialization() {
        let now = Utc::now();
        let meeting = MeetingModel {
            id: "meeting-123".to_string(),
            title: "Test Meeting".to_string(),
            created_at: DateTimeUtc(now),
            updated_at: DateTimeUtc(now),
            folder_path: Some("/path/to/folder".to_string()),
        };

        let json = serde_json::to_string(&meeting).expect("serialization failed");
        let deserialized: MeetingModel =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(meeting.id, deserialized.id);
        assert_eq!(meeting.title, deserialized.title);
        assert_eq!(meeting.folder_path, deserialized.folder_path);
    }

    #[test]
    fn test_meeting_model_without_folder_path() {
        let now = Utc::now();
        let meeting = MeetingModel {
            id: "meeting-456".to_string(),
            title: "Test Meeting No Folder".to_string(),
            created_at: DateTimeUtc(now),
            updated_at: DateTimeUtc(now),
            folder_path: None,
        };

        let json = serde_json::to_string(&meeting).expect("serialization failed");
        let deserialized: MeetingModel =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(deserialized.folder_path, None);
    }

    #[test]
    fn test_transcript_with_all_fields() {
        let transcript = Transcript {
            id: "trans-123".to_string(),
            meeting_id: "meeting-123".to_string(),
            transcript: "This is a transcript".to_string(),
            timestamp: "2025-01-01T12:00:00Z".to_string(),
            summary: Some("Summary text".to_string()),
            action_items: Some("Action 1, Action 2".to_string()),
            key_points: Some("Point 1, Point 2".to_string()),
            audio_start_time: Some(0.0),
            audio_end_time: Some(10.5),
            duration: Some(10.5),
            speaker: Some("user".to_string()),
        };

        let json = serde_json::to_string(&transcript).expect("serialization failed");
        let deserialized: Transcript =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(transcript.id, deserialized.id);
        assert_eq!(transcript.meeting_id, deserialized.meeting_id);
        assert_eq!(transcript.transcript, deserialized.transcript);
        assert_eq!(transcript.speaker, Some("user".to_string()));
    }

    #[test]
    fn test_transcript_with_minimal_fields() {
        let transcript = Transcript {
            id: "trans-456".to_string(),
            meeting_id: "meeting-456".to_string(),
            transcript: "Minimal transcript".to_string(),
            timestamp: "2025-01-01T13:00:00Z".to_string(),
            summary: None,
            action_items: None,
            key_points: None,
            audio_start_time: None,
            audio_end_time: None,
            duration: None,
            speaker: None,
        };

        let json = serde_json::to_string(&transcript).expect("serialization failed");
        let deserialized: Transcript =
            serde_json::from_str(&json).expect("deserialization failed");

        assert!(deserialized.summary.is_none());
        assert!(deserialized.speaker.is_none());
    }

    #[test]
    fn test_transcript_interlocutor_speaker() {
        let transcript = Transcript {
            id: "trans-789".to_string(),
            meeting_id: "meeting-789".to_string(),
            transcript: "Interlocutor says...".to_string(),
            timestamp: "2025-01-01T14:00:00Z".to_string(),
            summary: None,
            action_items: None,
            key_points: None,
            audio_start_time: Some(5.0),
            audio_end_time: Some(15.0),
            duration: Some(10.0),
            speaker: Some("interlocutor".to_string()),
        };

        assert_eq!(transcript.speaker, Some("interlocutor".to_string()));
    }

    #[test]
    fn test_setting_serialization() {
        let setting = Setting {
            id: "1".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            whisper_model: "large-v3".to_string(),
            groq_api_key: None,
            openai_api_key: Some("sk-test-key".to_string()),
            anthropic_api_key: None,
            ollama_api_key: None,
            open_router_api_key: None,
            ollama_endpoint: Some("http://localhost:11434".to_string()),
            custom_openai_config: None,
        };

        let json = serde_json::to_string(&setting).expect("serialization failed");
        let deserialized: Setting =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(setting.id, deserialized.id);
        assert_eq!(setting.provider, deserialized.provider);
        assert_eq!(setting.openai_api_key, deserialized.openai_api_key);
    }

    #[test]
    fn test_setting_all_api_keys_none() {
        let setting = Setting {
            id: "1".to_string(),
            provider: "builtin-ai".to_string(),
            model: "builtin".to_string(),
            whisper_model: "base".to_string(),
            groq_api_key: None,
            openai_api_key: None,
            anthropic_api_key: None,
            ollama_api_key: None,
            open_router_api_key: None,
            ollama_endpoint: None,
            custom_openai_config: None,
        };

        let json = serde_json::to_string(&setting).expect("serialization failed");
        let deserialized: Setting =
            serde_json::from_str(&json).expect("deserialization failed");

        assert!(deserialized.openai_api_key.is_none());
        assert!(deserialized.ollama_endpoint.is_none());
    }

    #[test]
    fn test_summary_process_serialization() {
        let now = Utc::now();
        let summary = SummaryProcess {
            meeting_id: "meeting-123".to_string(),
            status: "completed".to_string(),
            created_at: now,
            updated_at: now,
            error: None,
            result: Some(r#"{"summary":"Test summary"}"#.to_string()),
            start_time: Some(now),
            end_time: Some(now),
            chunk_count: 5,
            processing_time: 2.5,
            metadata: Some(r#"{"chunks":5}"#.to_string()),
            result_backup: None,
            result_backup_timestamp: None,
        };

        let json = serde_json::to_string(&summary).expect("serialization failed");
        let deserialized: SummaryProcess =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(summary.meeting_id, deserialized.meeting_id);
        assert_eq!(summary.status, deserialized.status);
        assert_eq!(summary.chunk_count, deserialized.chunk_count);
    }

    #[test]
    fn test_summary_process_with_error() {
        let now = Utc::now();
        let summary = SummaryProcess {
            meeting_id: "meeting-err".to_string(),
            status: "failed".to_string(),
            created_at: now,
            updated_at: now,
            error: Some("Network timeout".to_string()),
            result: None,
            start_time: Some(now),
            end_time: Some(now),
            chunk_count: 0,
            processing_time: 0.0,
            metadata: None,
            result_backup: None,
            result_backup_timestamp: None,
        };

        assert_eq!(summary.status, "failed");
        assert!(summary.error.is_some());
        assert!(summary.result.is_none());
    }

    #[test]
    fn test_transcript_chunk_serialization() {
        let now = Utc::now();
        let chunk = TranscriptChunk {
            meeting_id: "meeting-123".to_string(),
            meeting_name: Some("Team Meeting".to_string()),
            transcript_text: "Chunk text here".to_string(),
            model: "parakeet-tdt-0.6b-v3-int8".to_string(),
            model_name: "Parakeet".to_string(),
            chunk_size: Some(512),
            overlap: Some(50),
            created_at: now,
        };

        let json = serde_json::to_string(&chunk).expect("serialization failed");
        let deserialized: TranscriptChunk =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(chunk.meeting_id, deserialized.meeting_id);
        assert_eq!(chunk.model, deserialized.model);
        assert_eq!(chunk.chunk_size, Some(512));
    }

    #[test]
    fn test_transcript_chunk_without_optional_fields() {
        let now = Utc::now();
        let chunk = TranscriptChunk {
            meeting_id: "meeting-456".to_string(),
            meeting_name: None,
            transcript_text: "Minimal chunk".to_string(),
            model: "canary-1b-flash-int8".to_string(),
            model_name: "Canary".to_string(),
            chunk_size: None,
            overlap: None,
            created_at: now,
        };

        assert!(chunk.meeting_name.is_none());
        assert!(chunk.chunk_size.is_none());
    }

    #[test]
    fn test_transcript_setting_serialization() {
        let setting = TranscriptSetting {
            id: "1".to_string(),
            provider: "parakeet".to_string(),
            model: "parakeet-tdt-0.6b-v3-int8".to_string(),
            whisper_api_key: None,
            deepgram_api_key: None,
            eleven_labs_api_key: None,
            groq_api_key: None,
            openai_api_key: None,
        };

        let json = serde_json::to_string(&setting).expect("serialization failed");
        let deserialized: TranscriptSetting =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(setting.provider, deserialized.provider);
        assert_eq!(setting.model, deserialized.model);
    }

    #[test]
    fn test_transcript_setting_with_api_keys() {
        let setting = TranscriptSetting {
            id: "1".to_string(),
            provider: "groq".to_string(),
            model: "parakeet-tdt-0.6b-v3-int8".to_string(),
            whisper_api_key: None,
            deepgram_api_key: None,
            eleven_labs_api_key: None,
            groq_api_key: Some("groq-key-123".to_string()),
            openai_api_key: Some("openai-key-456".to_string()),
        };

        let json = serde_json::to_string(&setting).expect("serialization failed");
        let deserialized: TranscriptSetting =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(
            deserialized.groq_api_key,
            Some("groq-key-123".to_string())
        );
        assert_eq!(
            deserialized.openai_api_key,
            Some("openai-key-456".to_string())
        );
    }
}


#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptSetting {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[sqlx(rename = "whisperApiKey")]
    #[serde(rename = "whisperApiKey")]
    pub whisper_api_key: Option<String>,
    #[sqlx(rename = "deepgramApiKey")]
    #[serde(rename = "deepgramApiKey")]
    pub deepgram_api_key: Option<String>,
    #[sqlx(rename = "elevenLabsApiKey")]
    #[serde(rename = "elevenLabsApiKey")]
    pub eleven_labs_api_key: Option<String>,
    #[sqlx(rename = "groqApiKey")]
    #[serde(rename = "groqApiKey")]
    pub groq_api_key: Option<String>,
    #[sqlx(rename = "openaiApiKey")]
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: Option<String>,
}
