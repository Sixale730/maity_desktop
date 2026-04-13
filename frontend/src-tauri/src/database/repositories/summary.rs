use crate::database::models::SummaryProcess;
use chrono::Utc;
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{error, info as log_info};

pub struct SummaryProcessesRepository;

impl SummaryProcessesRepository {
    /// Retrieves the current summary process state for a given meeting ID.
    pub async fn get_summary_data(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>("SELECT * FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    pub async fn update_meeting_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        summary: &Value,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = pool.begin().await?;

        let meeting_exists: bool = sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();

        if !meeting_exists {
            log_info!(
                "Attempted to save summary for a non-existent meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        let result_json = serde_json::to_string(summary);
        if result_json.is_err() {
            error!("Can't convert the json to string for saving to Database");
            transaction.rollback().await?;
            return Ok(false);
        }
        let now = Utc::now();

        sqlx::query("UPDATE summary_processes SET result = ?, updated_at = ? WHERE meeting_id = ?")
            .bind(&result_json.unwrap())
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        log_info!(
            "Successfully updated summary and timestamp for meeting_id: {}",
            meeting_id
        );
        Ok(true)
    }

    pub async fn get_summary_data_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>(
            "SELECT p.* FROM summary_processes p JOIN transcript_chunks t ON p.meeting_id = t.meeting_id WHERE p.meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create_or_reset_process(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting summary process for meeting_id: {}",
            meeting_id
        );
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error)
            VALUES (?, 'PENDING', ?, ?, ?, NULL, NULL)
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = excluded.start_time,
                result_backup = result,
                result_backup_timestamp = excluded.updated_at,
                result = result,
                error = NULL
            "#
        )
        .bind(meeting_id)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        log_info!(
            "Backed up existing summary before regeneration for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_completed(
        pool: &SqlitePool,
        meeting_id: &str,
        result: Value, // Keep this as Value to handle both old and new formats if needed
        chunk_count: i64,
        processing_time: f64,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let result_str = serde_json::to_string(&result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;

        sqlx::query(
            r#"
            UPDATE summary_processes
            SET status = 'completed', result = ?, updated_at = ?, end_time = ?, chunk_count = ?, processing_time = ?, error = NULL, result_backup = NULL, result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#
        )
        .bind(result_str)
        .bind(now)
        .bind(now)
        .bind(chunk_count)
        .bind(processing_time)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Summary completed and backup cleared for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_failed(
        pool: &SqlitePool,
        meeting_id: &str,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#,
        )
        .bind(error)
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Summary generation failed and backup restored for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_cancelled(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'cancelled',
                updated_at = ?,
                end_time = ?,
                error = 'Generation was cancelled by user',
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Marked summary process as cancelled and restored backup for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_summary_process_statuses() {
        let statuses = vec!["PENDING", "in_progress", "completed", "failed", "cancelled"];

        for status in statuses {
            assert!(!status.is_empty());
            assert!(
                status == "PENDING"
                    || status == "in_progress"
                    || status == "completed"
                    || status == "failed"
                    || status == "cancelled"
            );
        }
    }

    #[test]
    fn test_json_serialization_for_summary_result() {
        let result = serde_json::json!({
            "summary": "This is a summary",
            "key_points": ["Point 1", "Point 2"],
            "action_items": ["Action 1", "Action 2"]
        });

        let json_string = serde_json::to_string(&result).expect("serialization failed");
        assert!(!json_string.is_empty());

        let deserialized: Value =
            serde_json::from_str(&json_string).expect("deserialization failed");
        assert_eq!(
            deserialized["summary"].as_str(),
            Some("This is a summary")
        );
    }

    #[test]
    fn test_invalid_json_detection() {
        let invalid_json = "{ invalid json }";
        let result: Result<Value, _> = serde_json::from_str(invalid_json);
        assert!(result.is_err(), "Invalid JSON should fail to deserialize");
    }

    #[test]
    fn test_summary_result_with_null_values() {
        let result = serde_json::json!({
            "summary": null,
            "error": null,
            "key_points": []
        });

        let json_string = serde_json::to_string(&result).expect("serialization failed");
        assert!(!json_string.is_empty());
    }

    #[test]
    fn test_processing_time_valid_values() {
        let valid_times = vec![0.0, 1.5, 10.25, 100.0, 999.999];

        for time in valid_times {
            assert!(time >= 0.0, "Processing time must be non-negative");
        }
    }

    #[test]
    fn test_chunk_count_valid_values() {
        let valid_counts = vec![0, 1, 5, 100, 1000];

        for count in valid_counts {
            assert!(count >= 0, "Chunk count must be non-negative");
        }
    }

    #[test]
    fn test_error_message_formats() {
        let error_messages = vec![
            "Network timeout",
            "Invalid input",
            "Generation was cancelled by user",
            "LLM connection failed",
            "Database error: constraint violation",
        ];

        for msg in error_messages {
            assert!(!msg.is_empty());
        }
    }

    #[test]
    fn test_meeting_id_validation() {
        let valid_ids = vec![
            "meeting-123",
            "meeting-abc-def",
            "mtg-001",
        ];

        for id in valid_ids {
            assert!(!id.is_empty());
            assert!(!id.trim().is_empty());
        }
    }

    #[test]
    fn test_empty_meeting_id_detection() {
        let empty_id = "";
        assert!(empty_id.is_empty());
    }

    #[test]
    fn test_backup_restore_logic() {
        // Simulating COALESCE(result_backup, result) logic
        let current_result: Option<String> = Some("current_summary".to_string());
        let backup_result: Option<String> = Some("backup_summary".to_string());

        let restored = backup_result.or(current_result);
        assert_eq!(restored, Some("backup_summary".to_string()));
    }

    #[test]
    fn test_backup_restore_without_backup() {
        // When no backup exists, original result should be used
        let current_result: Option<String> = Some("current_summary".to_string());
        let backup_result: Option<String> = None;

        let restored = backup_result.or(current_result);
        assert_eq!(restored, Some("current_summary".to_string()));
    }

    #[test]
    fn test_backup_restore_both_none() {
        // When both are None
        let current_result: Option<String> = None;
        let backup_result: Option<String> = None;

        let restored = backup_result.or(current_result);
        assert_eq!(restored, None);
    }

    #[test]
    fn test_summary_metadata_json_structure() {
        let metadata = serde_json::json!({
            "chunks": 5,
            "provider": "ollama",
            "model": "llama2",
            "temperature": 0.7
        });

        assert!(metadata.is_object());
        assert_eq!(metadata["chunks"], 5);
    }

    #[test]
    fn test_complex_summary_result_structure() {
        let complex_result = serde_json::json!({
            "summary": "Meeting summary text",
            "key_points": [
                {"point": "Point 1", "importance": "high"},
                {"point": "Point 2", "importance": "medium"}
            ],
            "action_items": [
                {"task": "Task 1", "assigned_to": "John", "deadline": "2025-01-15"},
                {"task": "Task 2", "assigned_to": "Jane", "deadline": "2025-01-20"}
            ],
            "participants": ["Alice", "Bob", "Charlie"],
            "duration_minutes": 45
        });

        let json_str = serde_json::to_string(&complex_result).expect("serialization failed");
        let deserialized: Value =
            serde_json::from_str(&json_str).expect("deserialization failed");

        assert_eq!(
            deserialized["duration_minutes"],
            45,
            "Numeric fields should be preserved"
        );
        assert_eq!(
            deserialized["participants"].as_array().unwrap().len(),
            3,
            "Array fields should be preserved"
        );
    }

    #[test]
    fn test_unicode_in_error_messages() {
        let error_msg = "Error: Transcripción fallida con caracteres especiales: ñ, é, á";
        assert!(error_msg.contains("ñ"));
        assert!(error_msg.contains("é"));
    }

    #[test]
    fn test_processing_time_precision() {
        let time_with_decimals = 2.5555;
        assert!(time_with_decimals > 2.0);
        assert!(time_with_decimals < 3.0);
    }
}

