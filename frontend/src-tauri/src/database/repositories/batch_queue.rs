//! Repositorio de `batch_transcription_queue` (F2 de la migración a lote).
//!
//! Patrón outbox como `sync_queue`: la fila nace al ARRANCAR el segmento
//! (`status='recording'`) — así la recuperación post-crash vive en Rust y no
//! depende del webview. El planner (`transcription/batch/planner.rs`) es el
//! único consumidor de `pending`.
//!
//! Las filas terminales (`done`/`discarded`/`failed`) se CONSERVAN — paridad
//! con la regla #26 de `sync_queue`: son el registro consultable por la UI y
//! la condición de elegibilidad de barridos futuros. Ningún `DELETE` aquí.

use crate::database::models::BatchQueueJob;
use sqlx::{Error as SqlxError, SqlitePool};

pub struct BatchQueueRepository;

impl BatchQueueRepository {
    /// Crea (o revive) la fila del segmento al ARRANCAR la grabación.
    /// Idempotente por `folder_path` (UNIQUE): reintentar el arranque sobre la
    /// misma carpeta actualiza metadatos en vez de fallar.
    pub async fn upsert_recording(
        pool: &SqlitePool,
        folder_path: &str,
        meeting_local_id: Option<&str>,
        segment_started_at: Option<&str>,
        trigger_kind: &str,
        user_id: &str,
    ) -> Result<i64, SqlxError> {
        sqlx::query(
            "INSERT INTO batch_transcription_queue
               (folder_path, meeting_local_id, segment_started_at, trigger_kind, status, user_id)
             VALUES (?, ?, ?, ?, 'recording', ?)
             ON CONFLICT(folder_path) DO UPDATE SET
               meeting_local_id = excluded.meeting_local_id,
               segment_started_at = excluded.segment_started_at,
               trigger_kind = excluded.trigger_kind,
               status = 'recording',
               updated_at = datetime('now')",
        )
        .bind(folder_path)
        .bind(meeting_local_id)
        .bind(segment_started_at)
        .bind(trigger_kind)
        .bind(user_id)
        .execute(pool)
        .await?;

        let (id,): (i64,) =
            sqlx::query_as("SELECT id FROM batch_transcription_queue WHERE folder_path = ?")
                .bind(folder_path)
                .fetch_one(pool)
                .await?;
        Ok(id)
    }

    /// Cierre del segmento: `recording` → `pending`. Devuelve `false` si la
    /// fila no estaba en `recording` (p. ej. ya recuperada por el drainer).
    pub async fn mark_pending(pool: &SqlitePool, folder_path: &str) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'pending', updated_at = datetime('now')
             WHERE folder_path = ? AND status = 'recording'",
        )
        .bind(folder_path)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// El job `pending` más viejo del usuario (FIFO por id).
    pub async fn next_pending(
        pool: &SqlitePool,
        user_id: &str,
    ) -> Result<Option<BatchQueueJob>, SqlxError> {
        sqlx::query_as::<_, BatchQueueJob>(
            "SELECT * FROM batch_transcription_queue
             WHERE status = 'pending' AND user_id = ?
             ORDER BY id ASC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
    }

    /// Claim del job. `AND status = 'pending'` es el MUTEX — nunca relajarlo.
    pub async fn claim(pool: &SqlitePool, id: i64) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'processing', updated_at = datetime('now')
             WHERE id = ? AND status = 'pending'",
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Cierre terminal exitoso: `done` (transcripción escrita) o `discarded`
    /// (el finalize de F3 decidirá descartes por umbral de palabras).
    pub async fn complete(
        pool: &SqlitePool,
        id: i64,
        final_status: &str,
    ) -> Result<bool, SqlxError> {
        debug_assert!(matches!(final_status, "done" | "discarded"));
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = ?, completed_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ? AND status = 'processing'",
        )
        .bind(final_status)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Fallo con reintento: incrementa `attempts`; al agotar `max_attempts`
    /// pasa a `failed` (el audio queda intacto en disco — el reintento manual
    /// o un arranque futuro pueden revivirlo).
    pub async fn fail(
        pool: &SqlitePool,
        id: i64,
        error_msg: &str,
        max_attempts: i64,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               attempts = attempts + 1,
               last_error = ?,
               status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
               updated_at = datetime('now')
             WHERE id = ? AND status = 'processing'",
        )
        .bind(error_msg)
        .bind(max_attempts)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Fallo PERMANENTE sin quemar intentos (carpeta desaparecida, etc.).
    pub async fn fail_permanent(
        pool: &SqlitePool,
        id: i64,
        error_msg: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'failed', last_error = ?, updated_at = datetime('now')
             WHERE id = ? AND status IN ('recording', 'pending', 'processing')",
        )
        .bind(error_msg)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Arranque: todo `processing` abandonado vuelve a `pending` (la app murió
    /// a mitad del job; el planner es single-flight, así que ninguna otra
    /// instancia puede tenerlo legítimamente).
    pub async fn reset_processing(pool: &SqlitePool) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'pending', updated_at = datetime('now')
             WHERE status = 'processing'",
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Filas `recording` (candidatas a recuperación post-crash: el drainer
    /// decide contra la grabación activa y el estado del disco).
    pub async fn recording_rows(pool: &SqlitePool) -> Result<Vec<BatchQueueJob>, SqlxError> {
        sqlx::query_as::<_, BatchQueueJob>(
            "SELECT * FROM batch_transcription_queue WHERE status = 'recording' ORDER BY id ASC",
        )
        .fetch_all(pool)
        .await
    }

    /// Recuperación post-crash: `recording` → `pending` con
    /// `trigger_kind='crash_recovery'`.
    pub async fn mark_crash_recovery(pool: &SqlitePool, id: i64) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'pending', trigger_kind = 'crash_recovery', updated_at = datetime('now')
             WHERE id = ? AND status = 'recording'",
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn pending_count(pool: &SqlitePool, user_id: &str) -> Result<i64, SqlxError> {
        let (n,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM batch_transcription_queue
             WHERE status = 'pending' AND user_id = ?",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(n)
    }

    pub async fn get_by_id(
        pool: &SqlitePool,
        id: i64,
    ) -> Result<Option<BatchQueueJob>, SqlxError> {
        sqlx::query_as::<_, BatchQueueJob>("SELECT * FROM batch_transcription_queue WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Espejo del SQL de la migración `20260909000000` (mismo patrón que los
    /// tests de `sync_queue`).
    const SCHEMA: &str = r#"
        CREATE TABLE batch_transcription_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT NOT NULL UNIQUE,
            meeting_local_id TEXT,
            segment_started_at TEXT,
            trigger_kind TEXT NOT NULL DEFAULT 'manual',
            status TEXT NOT NULL DEFAULT 'recording',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            user_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
        );
    "#;

    const TEST_USER: &str = "test-user";

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query(SCHEMA).execute(&pool).await.expect("schema");
        pool
    }

    async fn insert_recording(pool: &SqlitePool, folder: &str) -> i64 {
        BatchQueueRepository::upsert_recording(pool, folder, None, Some("2026-09-09 09:00:00"), "rotation", TEST_USER)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn ciclo_de_vida_normal() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "recording");
        assert_eq!(job.trigger_kind, "rotation");

        assert!(BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap());
        let next = BatchQueueRepository::next_pending(&pool, TEST_USER).await.unwrap().unwrap();
        assert_eq!(next.id, id);

        assert!(BatchQueueRepository::claim(&pool, id).await.unwrap());
        assert!(BatchQueueRepository::complete(&pool, id, "done").await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "done");
        assert!(job.completed_at.is_some());
    }

    #[tokio::test]
    async fn upsert_es_idempotente_por_folder() {
        let pool = setup_pool().await;
        let a = insert_recording(&pool, "C:/rec/seg1").await;
        let b = insert_recording(&pool, "C:/rec/seg1").await;
        assert_eq!(a, b, "la misma carpeta no duplica fila");
    }

    #[tokio::test]
    async fn claim_es_mutex() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        assert!(BatchQueueRepository::claim(&pool, id).await.unwrap());
        assert!(!BatchQueueRepository::claim(&pool, id).await.unwrap(), "segundo claim falla");
    }

    #[tokio::test]
    async fn mark_pending_solo_desde_recording() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        BatchQueueRepository::claim(&pool, id).await.unwrap();
        // Ya en processing: un segundo cierre no lo regresa a pending.
        assert!(!BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap());
    }

    #[tokio::test]
    async fn fail_reintenta_hasta_agotar() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();

        BatchQueueRepository::claim(&pool, id).await.unwrap();
        assert!(BatchQueueRepository::fail(&pool, id, "e1", 2).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.attempts, 1);

        BatchQueueRepository::claim(&pool, id).await.unwrap();
        assert!(BatchQueueRepository::fail(&pool, id, "e2", 2).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "failed");
        assert_eq!(job.attempts, 2);
        assert_eq!(job.last_error.as_deref(), Some("e2"));
    }

    #[tokio::test]
    async fn reset_processing_revive_jobs_abandonados() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        BatchQueueRepository::claim(&pool, id).await.unwrap();

        assert_eq!(BatchQueueRepository::reset_processing(&pool).await.unwrap(), 1);
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.attempts, 0, "el reset no quema intentos");
    }

    #[tokio::test]
    async fn crash_recovery_marca_pending_con_trigger() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        let rows = BatchQueueRepository::recording_rows(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);

        assert!(BatchQueueRepository::mark_crash_recovery(&pool, id).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.trigger_kind, "crash_recovery");
    }

    #[tokio::test]
    async fn next_pending_es_fifo_y_por_usuario() {
        let pool = setup_pool().await;
        let a = insert_recording(&pool, "C:/rec/seg1").await;
        let _b = insert_recording(&pool, "C:/rec/seg2").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg2").await.unwrap();
        // Fila de otro usuario, más vieja imposible (id mayor), no debe salir.
        BatchQueueRepository::upsert_recording(&pool, "C:/rec/otro", None, None, "manual", "otro-user")
            .await
            .unwrap();
        BatchQueueRepository::mark_pending(&pool, "C:/rec/otro").await.unwrap();

        let next = BatchQueueRepository::next_pending(&pool, TEST_USER).await.unwrap().unwrap();
        assert_eq!(next.id, a, "FIFO: el más viejo primero");
        assert_eq!(BatchQueueRepository::pending_count(&pool, TEST_USER).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn fail_permanent_no_quema_intentos() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        assert!(BatchQueueRepository::fail_permanent(&pool, id, "folder_missing").await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "failed");
        assert_eq!(job.attempts, 0);
        // Idempotente sobre terminal.
        assert!(!BatchQueueRepository::fail_permanent(&pool, id, "x").await.unwrap());
    }
}
