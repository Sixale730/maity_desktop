use crate::api::{MeetingDetails, MeetingTranscript};
use crate::database::models::{MeetingModel, Transcript};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqliteConnection, SqlitePool};
use tracing::{error, info};


pub struct MeetingsRepository;

impl MeetingsRepository {
    /// Get meetings owned by `user_id`. Legacy meetings (user_id NULL) are excluded by design
    /// — privacy isolation between Supabase accounts that share the same desktop install.
    pub async fn get_meetings(
        pool: &SqlitePool,
        user_id: &str,
    ) -> Result<Vec<MeetingModel>, sqlx::Error> {
        let meetings = sqlx::query_as::<_, MeetingModel>(
            "SELECT * FROM meetings WHERE user_id = ? ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(meetings)
    }

    /// Atomically read-or-create the cloud idempotency key for a meeting.
    ///
    /// Returns the existing key if one was already persisted (e.g. from a
    /// previous attempt that failed mid-sync). Otherwise generates a UUID v4,
    /// stores it, and returns it. Subsequent calls for the same meeting always
    /// return the same value — that's what makes save_conversation idempotent
    /// across retries.
    pub async fn get_or_create_idempotency_key(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<String, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        // Single statement: only updates when current value is NULL, returns
        // the resulting key either way. RETURNING is supported in SQLite ≥3.35.
        let row: Option<(String,)> = sqlx::query_as(
            "UPDATE meetings
             SET cloud_idempotency_key = COALESCE(cloud_idempotency_key, ?)
             WHERE id = ?
             RETURNING cloud_idempotency_key",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        row.map(|(k,)| k).ok_or(SqlxError::RowNotFound)
    }

    pub async fn delete_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        match delete_meeting_with_transaction(&mut transaction, meeting_id).await {
            Ok(success) => {
                if success {
                    transaction.commit().await?;
                    info!(
                        "Successfully deleted meeting {} and all associated data",
                        meeting_id
                    );
                    Ok(true)
                } else {
                    transaction.rollback().await?;
                    Ok(false)
                }
            }
            Err(e) => {
                let _ = transaction.rollback().await;
                error!("Failed to delete meeting {}: {}", meeting_id, e);
                Err(e)
            }
        }
    }

    pub async fn get_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingDetails>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        // Get meeting details (SELECT * to include all analysis columns
        // — FromRow on MeetingModel needs every NOT NULL column).
        let meeting: Option<MeetingModel> =
            sqlx::query_as("SELECT * FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_optional(&mut *transaction)
                .await?;

        if meeting.is_none() {
            transaction.rollback().await?;
            return Err(SqlxError::RowNotFound);
        }

        if let Some(meeting) = meeting {
            // Get all transcripts for this meeting
            let transcripts =
                sqlx::query_as::<_, Transcript>("SELECT * FROM transcripts WHERE meeting_id = ?")
                    .bind(meeting_id)
                    .fetch_all(&mut *transaction)
                    .await?;

            transaction.commit().await?;

            // Convert Transcript to MeetingTranscript
            let meeting_transcripts = transcripts
                .into_iter()
                .map(|t| MeetingTranscript {
                    id: t.id,
                    text: t.transcript,
                    timestamp: t.timestamp,
                    audio_start_time: t.audio_start_time,
                    audio_end_time: t.audio_end_time,
                    duration: t.duration,
                    source_type: t.speaker,
                })
                .collect::<Vec<_>>();

            Ok(Some(MeetingDetails {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at.0.to_rfc3339(),
                updated_at: meeting.updated_at.0.to_rfc3339(),
                transcripts: meeting_transcripts,
            }))
        } else {
            transaction.rollback().await?;
            Ok(None)
        }
    }

    /// Get meeting metadata without transcripts (for pagination)
    pub async fn get_meeting_metadata(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let meeting: Option<MeetingModel> =
            sqlx::query_as("SELECT * FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_optional(pool)
                .await?;

        Ok(meeting)
    }

    /// Update the status + data + error of a single analysis phase
    /// (quick / full / minutes). Used by the analysis module to persist
    /// progress as each Gemma sidecar invocation completes or fails.
    pub async fn update_analysis_phase(
        pool: &SqlitePool,
        meeting_id: &str,
        kind: crate::database::models::AnalysisPhaseKind,
        status: crate::database::models::AnalysisPhaseStatus,
        data: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), SqlxError> {
        use crate::database::models::AnalysisPhaseKind;
        let (status_col, data_col, error_col) = match kind {
            AnalysisPhaseKind::Quick => (
                "analysis_quick_status",
                "analysis_quick_data",
                "analysis_quick_error",
            ),
            AnalysisPhaseKind::Full => (
                "analysis_full_status",
                "analysis_full_data",
                "analysis_full_error",
            ),
            AnalysisPhaseKind::Minutes => ("minutes_status", "minutes_data", "minutes_error"),
        };

        let now = Utc::now();
        let sql = format!(
            "UPDATE meetings SET {status} = ?, {data} = ?, {err} = ?, updated_at = ? WHERE id = ?",
            status = status_col,
            data = data_col,
            err = error_col,
        );

        sqlx::query(&sql)
            .bind(status.as_str())
            .bind(data)
            .bind(error)
            .bind(now)
            .bind(meeting_id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// Persist deterministic data (muletillas, ratios, preguntas, etc.)
    /// computed in Rust without an LLM. Stored separately from analysis
    /// phases so KPIs can render in seconds while the LLM runs.
    pub async fn set_deterministic_data(
        pool: &SqlitePool,
        meeting_id: &str,
        data: &str,
    ) -> Result<(), SqlxError> {
        sqlx::query(
            "UPDATE meetings SET deterministic_data = ?, updated_at = ? WHERE id = ?",
        )
        .bind(data)
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Mark the meeting's analysis as coming from local Gemma vs cloud.
    /// Default 'cloud' for migrated meetings; set to 'local_gemma' when
    /// the local analysis pipeline runs.
    pub async fn set_analysis_source(
        pool: &SqlitePool,
        meeting_id: &str,
        source: &str,
    ) -> Result<(), SqlxError> {
        sqlx::query(
            "UPDATE meetings SET analysis_source = ?, updated_at = ? WHERE id = ?",
        )
        .bind(source)
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Get meeting transcripts with pagination support
    pub async fn get_meeting_transcripts_paginated(
        pool: &SqlitePool,
        meeting_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Transcript>, i64), SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        // Get total count of transcripts for this meeting
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?"
        )
        .bind(meeting_id)
        .fetch_one(pool)
        .await?;

        // Get paginated transcripts ordered by audio_start_time
        let transcripts = sqlx::query_as::<_, Transcript>(
            "SELECT * FROM transcripts
             WHERE meeting_id = ?
             ORDER BY audio_start_time ASC
             LIMIT ? OFFSET ?"
        )
        .bind(meeting_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        Ok((transcripts, total.0))
    }

    pub async fn update_meeting_title(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now().naive_utc();

        let rows_affected =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;
        if rows_affected.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn update_meeting_name(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        let mut transaction = pool.begin().await?;
        let now = Utc::now();

        // Update meetings table
        let meeting_update =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;

        if meeting_update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false); // Meeting not found
        }

        // Update transcript_chunks table
        sqlx::query("UPDATE transcript_chunks SET meeting_name = ? WHERE meeting_id = ?")
            .bind(new_title)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;
        Ok(true)
    }

    /// Reuniones candidatas al barrido de retención de audio.
    ///
    /// La condición de "ya se puede borrar" es LOCAL y no necesitó columnas
    /// nuevas: una fila de `sync_queue` con `job_type='finalize_conversation'`
    /// y `status='completed'` significa que la conversación existe en Supabase
    /// **con sus segmentos** (la cadena `depends_on` lo garantiza) y que la nube
    /// ya dijo lo suyo del análisis; `completed_at` da la edad. Esas filas
    /// además no se purgan nunca: la poda de la cola
    /// (`SyncQueueRepository::trim_completed_payloads`, #26 de la auditoría)
    /// vacía el `payload` pero conserva la fila, su `status` y su
    /// `completed_at` justo para que esta consulta siga viéndolas; la vieja
    /// `cleanup_old_completed` (un `DELETE` sin call sites) se borró por eso.
    ///
    /// El predicado de edad es el mismo de `trim_completed_payloads`
    /// (`datetime('now', '-' || ? || ' days')`) y compara contra el
    /// `datetime('now')` que escribe `complete_job` — mismo formato de texto,
    /// comparación lexicográfica correcta.
    ///
    /// Devuelve `(id, folder_path)`. `folder_path` es la ÚNICA verdad sobre
    /// dónde está la carpeta: `RecordingSaver::initialize_meeting_folder` usa
    /// `get_default_recordings_folder()` y NO `preferences.save_folder`, así que
    /// escanear la carpeta de preferencias barrería el directorio equivocado.
    pub async fn list_audio_retention_candidates(
        pool: &SqlitePool,
        days: i64,
        limit: i64,
    ) -> Result<Vec<(String, String)>, SqlxError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT m.id, m.folder_path
             FROM meetings m
             WHERE m.folder_path IS NOT NULL
               AND m.audio_deleted_at IS NULL
               AND EXISTS (
                   SELECT 1 FROM sync_queue q
                   WHERE q.meeting_id = m.id
                     AND q.job_type = 'finalize_conversation'
                     AND q.status = 'completed'
                     AND q.completed_at IS NOT NULL
                     AND q.completed_at <= datetime('now', '-' || ? || ' days')
               )
             ORDER BY m.created_at ASC
             LIMIT ?",
        )
        .bind(days)
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Marca el audio de una reunión como barrido.
    ///
    /// Se llama TAMBIÉN cuando el `audio.mp4` ya no existía (borrado a mano por
    /// el usuario, carpeta movida): sin la marca, esa fila volvería a salir
    /// candidata cada 6 h y el barrido gastaría un `stat` por pasada para nada.
    /// El `AND audio_deleted_at IS NULL` la hace idempotente: una segunda
    /// llamada devuelve `false` sin pisar la fecha original.
    pub async fn mark_audio_deleted(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol("meeting_id cannot be empty".to_string()));
        }

        let result = sqlx::query(
            "UPDATE meetings SET audio_deleted_at = datetime('now')
             WHERE id = ? AND audio_deleted_at IS NULL",
        )
        .bind(meeting_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}

async fn delete_meeting_with_transaction(
    transaction: &mut SqliteConnection,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    // Check if meeting exists
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;

    if meeting_exists.is_none() {
        error!("Meeting {} not found for deletion", meeting_id);
        return Ok(false);
    }

    // Delete from related tables in proper order
    // 0. Delete from sync_queue (cancel pending cloud syncs)
    sqlx::query("DELETE FROM sync_queue WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 1. Delete from recording_logs
    sqlx::query("DELETE FROM recording_logs WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 2. Delete from transcript_chunks
    sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 3. Delete from summary_processes
    sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 4. Delete from transcripts
    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 5. Finally, delete the meeting
    let result = sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    //! Tests del barrido de retención de audio a nivel repositorio.
    //!
    //! Pool `:memory:` con las MIGRACIONES REALES (`sqlx::migrate!`), no un
    //! SCHEMA a mano: la consulta cruza `meetings.audio_deleted_at` (columna
    //! recién migrada) con `sync_queue.completed_at`, y un esquema hand-written
    //! se desincroniza en silencio (es justo lo que documenta el harness de
    //! `scheduled_recording/service.rs`).

    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1) // `:memory:` da una DB por conexión; capar a 1 mantiene una sola.
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    async fn insert_meeting_con_carpeta(pool: &SqlitePool, id: &str, folder: &str) {
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind("Reunión de prueba")
        .bind("2026-01-01T00:00:00Z")
        .bind("2026-01-01T00:00:00Z")
        .bind(folder)
        .execute(pool)
        .await
        .expect("insert meeting");
    }

    /// `dias_atras` negativo hacia el pasado: 40 = el finalize completó hace 40 días.
    async fn insert_finalize_job(pool: &SqlitePool, meeting_id: &str, status: &str, dias_atras: i64) {
        sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, status, completed_at)
             VALUES ('finalize_conversation', ?, '{}', ?, datetime('now', '-' || ? || ' days'))",
        )
        .bind(meeting_id)
        .bind(status)
        .bind(dias_atras)
        .execute(pool)
        .await
        .expect("insert sync_queue job");
    }

    #[tokio::test]
    async fn candidata_elegible_cuando_el_finalize_completo_hace_mas_de_n_dias() {
        let pool = setup_pool().await;
        insert_meeting_con_carpeta(&pool, "m1", "C:/rec/m1").await;
        insert_finalize_job(&pool, "m1", "completed", 40).await;

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 200)
            .await
            .expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "m1");
        assert_eq!(rows[0].1, "C:/rec/m1");
    }

    #[tokio::test]
    async fn no_elegible_si_el_finalize_es_mas_reciente_que_la_retencion() {
        let pool = setup_pool().await;
        insert_meeting_con_carpeta(&pool, "m1", "C:/rec/m1").await;
        insert_finalize_job(&pool, "m1", "completed", 3).await;

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 200)
            .await
            .expect("query");

        assert!(rows.is_empty(), "3 días < 30 de retención: el audio no se toca");
    }

    /// Sin `finalize_conversation` completado la reunión NO está confirmada en la
    /// nube; borrar su audio sería tirar el único respaldo que queda.
    #[tokio::test]
    async fn no_elegible_sin_finalize_completed() {
        let pool = setup_pool().await;
        insert_meeting_con_carpeta(&pool, "sin_job", "C:/rec/a").await;

        insert_meeting_con_carpeta(&pool, "pendiente", "C:/rec/b").await;
        insert_finalize_job(&pool, "pendiente", "pending", 40).await;

        insert_meeting_con_carpeta(&pool, "fallido", "C:/rec/c").await;
        insert_finalize_job(&pool, "fallido", "failed", 40).await;

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 200)
            .await
            .expect("query");

        assert!(rows.is_empty(), "sólo cuenta un finalize_conversation 'completed'");
    }

    #[tokio::test]
    async fn no_elegible_si_ya_esta_marcada_como_barrida() {
        let pool = setup_pool().await;
        insert_meeting_con_carpeta(&pool, "m1", "C:/rec/m1").await;
        insert_finalize_job(&pool, "m1", "completed", 40).await;

        assert!(MeetingsRepository::mark_audio_deleted(&pool, "m1").await.unwrap());

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 200)
            .await
            .expect("query");

        assert!(rows.is_empty(), "audio_deleted_at evita re-visitar la misma fila");
    }

    #[tokio::test]
    async fn no_elegible_sin_folder_path() {
        let pool = setup_pool().await;
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?,?,?,?)")
            .bind("sin_carpeta")
            .bind("Sin carpeta")
            .bind("2026-01-01T00:00:00Z")
            .bind("2026-01-01T00:00:00Z")
            .execute(&pool)
            .await
            .unwrap();
        insert_finalize_job(&pool, "sin_carpeta", "completed", 40).await;

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 200)
            .await
            .expect("query");

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn el_limite_capa_la_pasada() {
        let pool = setup_pool().await;
        for i in 0..5 {
            let id = format!("m{}", i);
            insert_meeting_con_carpeta(&pool, &id, &format!("C:/rec/{}", id)).await;
            insert_finalize_job(&pool, &id, "completed", 40).await;
        }

        let rows = MeetingsRepository::list_audio_retention_candidates(&pool, 30, 2)
            .await
            .expect("query");

        assert_eq!(rows.len(), 2, "el tope por pasada acota el trabajo de una corrida");
    }

    #[tokio::test]
    async fn mark_audio_deleted_es_idempotente() {
        let pool = setup_pool().await;
        insert_meeting_con_carpeta(&pool, "m1", "C:/rec/m1").await;

        assert!(MeetingsRepository::mark_audio_deleted(&pool, "m1").await.unwrap());
        assert!(
            !MeetingsRepository::mark_audio_deleted(&pool, "m1").await.unwrap(),
            "la segunda llamada no debe pisar la fecha original"
        );
    }
}
