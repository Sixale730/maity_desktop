use sqlx::{migrate::MigrateDatabase, Result, Sqlite, SqlitePool, Transaction};
use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str, backend_db_path: &str) -> Result<Self> {
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(|e| sqlx::Error::Io(e))?;
            }
        }

        if !Path::new(tauri_db_path).exists() {
            if Path::new(backend_db_path).exists() {
                log::info!(
                    "Copying database from {} to {}",
                    backend_db_path,
                    tauri_db_path
                );
                fs::copy(backend_db_path, tauri_db_path).map_err(|e| sqlx::Error::Io(e))?;
            } else {
                log::info!("Creating database at {}", tauri_db_path);
                Sqlite::create_database(tauri_db_path).await?;
            }
        }

        let pool = SqlitePool::connect(tauri_db_path).await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(DatabaseManager { pool })
    }

    // NOTE: So for the first time users they needs to start the application
    // after they can just delete the existing .sqlite file and then copy the existing .db file to
    // the current app dir, So the system detects legacy db and copy it and starts with that data
    // (Newly created .sqlite with the copied content from .db)
    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // Legacy backend DB path (for auto-migration if exists)
        let backend_db_path = app_data_dir
            .join("meeting_minutes.db")
            .to_string_lossy()
            .to_string();

        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);
        log::info!("Legacy backend DB path: {}", backend_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path, &backend_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path, &backend_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!("Database connection failed even after WAL cleanup: {}", retry_err);
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    /// Import a legacy database from the specified path and initialize
    pub async fn import_legacy_database(
        app_handle: &tauri::AppHandle,
        legacy_db_path: &str,
    ) -> Result<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Copy legacy database to app data directory as meeting_minutes.db
        let target_legacy_path = app_data_dir.join("meeting_minutes.db");
        log::info!(
            "Copying legacy database from {} to {}",
            legacy_db_path,
            target_legacy_path.display()
        );

        fs::copy(legacy_db_path, &target_legacy_path).map_err(|e| sqlx::Error::Io(e))?;

        // Now use the standard initialization which will detect and migrate the legacy db
        Self::new_from_app_handle(app_handle).await
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Force checkpoint of WAL to main database file and remove WAL file
        // TRUNCATE mode: checkpoints all pages AND deletes the WAL file
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
        {
            Ok(_) => log::info!("WAL checkpoint completed successfully"),
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }

}

// ============================================================================
// B.2 — Live transcript streaming helpers
// ============================================================================

/// Row shape of `transcript_segments_live`. Kept in this module so other
/// modules can consume it without pulling in sqlx directly.
#[derive(Debug, Clone)]
pub struct LiveTranscriptRow {
    pub meeting_id: String,
    pub sequence_id: i64,
    pub segment_id: String,
    pub text: String,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
    pub duration: f64,
    pub display_time: String,
    pub confidence: f64,
    pub source_type: Option<String>,
}

impl DatabaseManager {
    /// Upsert a single segment into `transcript_segments_live`. Called as a
    /// best-effort secondary write alongside the canonical `transcripts.json`.
    /// If the insert fails, the caller should log and continue — the JSON
    /// remains the source of truth during normal operation.
    pub async fn upsert_live_transcript(&self, row: &LiveTranscriptRow) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO transcript_segments_live (
                meeting_id, sequence_id, segment_id, text,
                audio_start_time, audio_end_time, duration,
                display_time, confidence, source_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id, sequence_id) DO UPDATE SET
                segment_id       = excluded.segment_id,
                text             = excluded.text,
                audio_start_time = excluded.audio_start_time,
                audio_end_time   = excluded.audio_end_time,
                duration         = excluded.duration,
                display_time     = excluded.display_time,
                confidence       = excluded.confidence,
                source_type      = excluded.source_type",
        )
        .bind(&row.meeting_id)
        .bind(row.sequence_id)
        .bind(&row.segment_id)
        .bind(&row.text)
        .bind(row.audio_start_time)
        .bind(row.audio_end_time)
        .bind(row.duration)
        .bind(&row.display_time)
        .bind(row.confidence)
        .bind(&row.source_type)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete all live rows for a meeting. Called when the recording is
    /// finalized successfully and the canonical JSON is safely on disk.
    pub async fn purge_live_transcript(&self, meeting_id: &str) -> sqlx::Result<u64> {
        let result = sqlx::query("DELETE FROM transcript_segments_live WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Read all live rows for a meeting, ordered by sequence_id. Used on
    /// crash recovery to rebuild `transcripts.json` when it is missing.
    pub async fn load_live_transcript(
        &self,
        meeting_id: &str,
    ) -> sqlx::Result<Vec<LiveTranscriptRow>> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT meeting_id, sequence_id, segment_id, text,
                    audio_start_time, audio_end_time, duration,
                    display_time, confidence, source_type
             FROM transcript_segments_live
             WHERE meeting_id = ?
             ORDER BY sequence_id ASC",
        )
        .bind(meeting_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| LiveTranscriptRow {
                meeting_id: r.get("meeting_id"),
                sequence_id: r.get("sequence_id"),
                segment_id: r.get("segment_id"),
                text: r.get("text"),
                audio_start_time: r.get("audio_start_time"),
                audio_end_time: r.get("audio_end_time"),
                duration: r.get("duration"),
                display_time: r.get("display_time"),
                confidence: r.get("confidence"),
                source_type: r.get("source_type"),
            })
            .collect())
    }
}
