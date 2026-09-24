use crate::database::models::RecordingLog;
use sqlx::{Error as SqlxError, SqlitePool};
use tracing::error;

pub struct RecordingLogRepository;

impl RecordingLogRepository {
    /// Insert a new recording lifecycle event
    pub async fn log_event(
        pool: &SqlitePool,
        session_id: &str,
        event_type: &str,
        event_data: Option<&str>,
        status: Option<&str>,
        error_msg: Option<&str>,
        meeting_id: Option<&str>,
        app_version: Option<&str>,
        device_info: Option<&str>,
    ) -> Result<i64, SqlxError> {
        let result = sqlx::query(
            "INSERT INTO recording_logs (session_id, event_type, event_data, status, error, meeting_id, app_version, device_info)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(event_type)
        .bind(event_data)
        .bind(status)
        .bind(error_msg)
        .bind(meeting_id)
        .bind(app_version)
        .bind(device_info)
        .execute(pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    /// Get logs for a specific session
    pub async fn get_logs_by_session(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Vec<RecordingLog>, SqlxError> {
        sqlx::query_as::<_, RecordingLog>(
            "SELECT * FROM recording_logs WHERE session_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(pool)
        .await
    }

    /// Get most recent logs (across all sessions)
    pub async fn get_recent_logs(
        pool: &SqlitePool,
        limit: i64,
    ) -> Result<Vec<RecordingLog>, SqlxError> {
        sqlx::query_as::<_, RecordingLog>(
            "SELECT * FROM recording_logs ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Get logs not yet synced to cloud
    pub async fn get_unsynced_logs(
        pool: &SqlitePool,
        limit: i64,
    ) -> Result<Vec<RecordingLog>, SqlxError> {
        sqlx::query_as::<_, RecordingLog>(
            "SELECT * FROM recording_logs WHERE synced_to_cloud = 0 ORDER BY created_at ASC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Mark logs as synced to cloud
    pub async fn mark_as_synced(
        pool: &SqlitePool,
        ids: &[i64],
    ) -> Result<u64, SqlxError> {
        if ids.is_empty() {
            return Ok(0);
        }

        // Build placeholder string for IN clause
        let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
        let query_str = format!(
            "UPDATE recording_logs SET synced_to_cloud = 1 WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut query = sqlx::query(&query_str);
        for id in ids {
            query = query.bind(id);
        }

        let result = query.execute(pool).await?;
        Ok(result.rows_affected())
    }

    /// Export recent logs as JSON string (for ZIP export)
    pub async fn export_all_logs_json(
        pool: &SqlitePool,
    ) -> Result<String, SqlxError> {
        let logs = Self::get_recent_logs(pool, 500).await?;
        serde_json::to_string_pretty(&logs).map_err(|e| {
            error!("Failed to serialize recording logs: {}", e);
            SqlxError::Protocol(format!("JSON serialization error: {}", e))
        })
    }

    /// Delete recording logs associated with a meeting (for cascade delete)
    pub async fn delete_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query("DELETE FROM recording_logs WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Una fila puntual por id (para `drain::flush_row`: revisa si ya se
    /// sincronizó o si sigue en el outbox antes de reclamarla).
    pub async fn get_by_id(
        pool: &SqlitePool,
        id: i64,
    ) -> Result<Option<RecordingLog>, SqlxError> {
        sqlx::query_as::<_, RecordingLog>("SELECT * FROM recording_logs WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    /// `app_version` más reciente escrito por OTRO proceso (para el `app.start`
    /// del ciclo de vida: línea de respaldo cuando el marcador en disco no
    /// existe o está corrupto). `event_data` es texto libre — algunas filas
    /// vienen de un fallback que guardó un string plano cuando el payload no
    /// era JSON (`drain.rs::post_row`) — por eso `json_extract` va dentro de un
    /// `CASE WHEN json_valid(...)`: `json_extract` sobre texto no-JSON da error
    /// (no NULL) y SQLite no garantiza el orden de evaluación de un `OR`, así
    /// que solo el `CASE` asegura que la fila se descarte sin tumbar la consulta.
    pub async fn last_app_version_excluding_session(
        pool: &SqlitePool,
        proc_session_id: &str,
    ) -> Result<Option<String>, SqlxError> {
        sqlx::query_scalar::<_, String>(
            "SELECT app_version FROM recording_logs
              WHERE app_version IS NOT NULL AND app_version <> ''
                AND coalesce(CASE WHEN json_valid(event_data)
                                  THEN json_extract(event_data, '$.ctx.session_id') END, '') <> ?
              ORDER BY id DESC LIMIT 1",
        )
        .bind(proc_session_id)
        .fetch_optional(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    //! Pool `:memory:` con las MIGRACIONES REALES (`sqlx::migrate!`), no un
    //! esquema a mano: `last_app_version_excluding_session` depende del filtro
    //! `json_valid`/`json_extract` de SQLite, que no se puede simular con un
    //! `CREATE TABLE` hecho a mano.
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

    async fn insert_row(
        pool: &SqlitePool,
        session_id: &str,
        event_data: Option<&str>,
        app_version: Option<&str>,
    ) -> i64 {
        RecordingLogRepository::log_event(
            pool,
            session_id,
            "app.start",
            event_data,
            None,
            None,
            None,
            app_version,
            None,
        )
        .await
        .expect("insert recording_log")
    }

    #[tokio::test]
    async fn get_by_id_devuelve_none_si_no_existe() {
        let pool = setup_pool().await;
        let row = RecordingLogRepository::get_by_id(&pool, 999)
            .await
            .expect("query ok");
        assert!(row.is_none());
    }

    #[tokio::test]
    async fn get_by_id_refleja_synced_to_cloud_tras_marcar() {
        let pool = setup_pool().await;
        let id = insert_row(&pool, "proc-a", None, Some("0.2.62")).await;

        let antes = RecordingLogRepository::get_by_id(&pool, id)
            .await
            .expect("query ok")
            .expect("fila existe");
        assert!(!antes.synced_to_cloud);

        RecordingLogRepository::mark_as_synced(&pool, &[id])
            .await
            .expect("mark ok");

        let despues = RecordingLogRepository::get_by_id(&pool, id)
            .await
            .expect("query ok")
            .expect("fila existe");
        assert!(despues.synced_to_cloud);
    }

    #[tokio::test]
    async fn last_app_version_excluding_session_ignora_el_proceso_actual() {
        let pool = setup_pool().await;
        insert_row(
            &pool,
            "proc-a",
            Some(r#"{"ctx":{"session_id":"proc-a"}}"#),
            Some("0.2.61"),
        )
        .await;
        insert_row(
            &pool,
            "proc-b",
            Some(r#"{"ctx":{"session_id":"proc-b"}}"#),
            Some("0.2.62"),
        )
        .await;

        let v = RecordingLogRepository::last_app_version_excluding_session(&pool, "proc-b")
            .await
            .expect("query ok");
        assert_eq!(v, Some("0.2.61".to_string()));
    }

    #[tokio::test]
    async fn last_app_version_excluding_session_tolera_event_data_no_json() {
        let pool = setup_pool().await;
        // Fallback de drain.rs::post_row: si el JSON no parsea, guarda el
        // string crudo — sin el guard `json_valid` esta fila haría fallar toda
        // la consulta con un error de SQLite, no solo excluirse.
        insert_row(&pool, "proc-legacy", Some("no es json"), Some("0.2.55")).await;

        let v = RecordingLogRepository::last_app_version_excluding_session(&pool, "proc-b")
            .await
            .expect("query ok, la fila con event_data inválido no rompe json_extract");
        assert_eq!(v, Some("0.2.55".to_string()));
    }

    #[tokio::test]
    async fn last_app_version_excluding_session_sin_filas_devuelve_none() {
        let pool = setup_pool().await;
        let v = RecordingLogRepository::last_app_version_excluding_session(&pool, "proc-b")
            .await
            .expect("query ok");
        assert!(v.is_none());
    }
}
