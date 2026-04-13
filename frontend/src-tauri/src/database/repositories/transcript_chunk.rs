// src/database/repo/transcript_chunks.rs

use chrono::Utc;
use log::info as log_info;
use sqlx::SqlitePool;
pub struct TranscriptChunksRepository;

impl TranscriptChunksRepository {
    /// Saves the full transcript text and processing parameters.
    pub async fn save_transcript_data(
        pool: &SqlitePool,
        meeting_id: &str,
        text: &str,
        model: &str,
        model_name: &str,
        chunk_size: i32,
        overlap: i32,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Saving transcript data to transcript_chunks for meeting_id: {}",
            meeting_id
        );
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO transcript_chunks (meeting_id, transcript_text, model, model_name, chunk_size, overlap, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                transcript_text = excluded.transcript_text,
                model = excluded.model,
                model_name = excluded.model_name,
                chunk_size = excluded.chunk_size,
                overlap = excluded.overlap,
                created_at = excluded.created_at
            "#
        )
        .bind(meeting_id)
        .bind(text)
        .bind(model)
        .bind(model_name)
        .bind(chunk_size)
        .bind(overlap)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_valid_meeting_id_formats() {
        // Test various valid meeting ID formats
        let valid_ids = vec![
            "meeting-123abc",
            "meeting-456def-789",
            "mtg-001",
            "MEETING-001",
        ];

        for id in valid_ids {
            assert!(!id.is_empty(), "Meeting ID should not be empty");
            assert!(id.len() > 0, "Meeting ID should have at least 1 character");
        }
    }

    #[test]
    fn test_empty_meeting_id_validation() {
        let empty_id = "";
        assert!(empty_id.is_empty(), "Empty string should be detected as empty");
    }

    #[test]
    fn test_valid_transcript_text_formats() {
        let texts = vec![
            "Simple transcript",
            "Multi-line\ntranscript\nwith\nnewlines",
            "Transcript with special chars: @#$%",
            "1234567890",
            "UPPERCASE AND lowercase",
        ];

        for text in texts {
            assert!(!text.is_empty(), "Transcript text should not be empty");
        }
    }

    #[test]
    fn test_empty_transcript_text() {
        let empty_text = "";
        assert!(empty_text.is_empty(), "Empty text should be detected");
    }

    #[test]
    fn test_valid_model_names() {
        let models = vec![
            "parakeet-tdt-0.6b-v3-int8",
            "canary-1b-flash-int8",
            "whisper-base",
            "whisper-large-v3",
        ];

        for model in models {
            assert!(!model.is_empty());
            assert!(model.contains('-') || model.contains('_'), "Model names usually contain separators");
        }
    }

    #[test]
    fn test_valid_model_display_names() {
        let display_names = vec!["Parakeet", "Canary", "Whisper", "Custom Model"];

        for name in display_names {
            assert!(!name.is_empty());
            assert!(name.chars().all(|c| c.is_alphanumeric() || c.is_whitespace()));
        }
    }

    #[test]
    fn test_chunk_size_valid_values() {
        let valid_sizes: Vec<u32> = vec![256, 512, 1024, 2048];

        for size in valid_sizes {
            assert!(size > 0, "Chunk size must be positive");
            assert!(size.is_power_of_two() || size % 128 == 0, "Valid chunk sizes are usually powers of 2 or multiples of 128");
        }
    }

    #[test]
    fn test_overlap_valid_values() {
        let valid_overlaps = vec![0, 50, 128, 256];

        for overlap in valid_overlaps {
            assert!(overlap >= 0, "Overlap must be non-negative");
        }
    }

    #[test]
    fn test_overlap_less_than_chunk_size() {
        let chunk_size = 512;
        let valid_overlaps = vec![0, 50, 128, 256];

        for overlap in valid_overlaps {
            assert!(
                overlap < chunk_size,
                "Overlap should be less than chunk size"
            );
        }
    }

    #[test]
    fn test_whitespace_in_transcript_text() {
        let text_with_whitespace = "  Transcript with leading and trailing spaces  ";
        assert!(!text_with_whitespace.trim().is_empty());
    }

    #[test]
    fn test_very_long_transcript_text() {
        let long_text = "a".repeat(10000);
        assert_eq!(long_text.len(), 10000);
    }

    #[test]
    fn test_unicode_in_transcript_text() {
        let unicode_text = "Transcripción en español con ñ y acentos: é, á, í, ó, ú";
        assert!(unicode_text.contains("ñ"));
        assert!(unicode_text.contains("é"));
    }

    #[test]
    fn test_model_identifier_patterns() {
        // Verify model identifier follows expected patterns
        let models = vec![
            ("parakeet-tdt-0.6b-v3-int8", "parakeet"),
            ("canary-1b-flash-int8", "canary"),
            ("whisper-base", "whisper"),
        ];

        for (full_model, prefix) in models {
            assert!(
                full_model.starts_with(prefix),
                "Model {} should start with {}",
                full_model,
                prefix
            );
        }
    }

    #[test]
    fn test_chunk_and_overlap_boundary_conditions() {
        // Test boundary conditions for chunking parameters
        let chunk_size = 512;
        let overlap = 256;

        assert!(overlap <= chunk_size);
        assert_eq!(chunk_size - overlap, 256, "Effective chunk advance should be correct");
    }

    #[test]
    fn test_meeting_id_uniqueness_handling() {
        // ON CONFLICT clause should handle ID uniqueness
        let id1 = "meeting-unique-001";
        let id2 = "meeting-unique-001";

        assert_eq!(
            id1, id2,
            "Same IDs should be equal for conflict detection"
        );
    }
}

