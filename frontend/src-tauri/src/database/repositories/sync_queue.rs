use crate::database::models::{MeetingSyncStatus, SyncQueueJob};
use sqlx::{Error as SqlxError, SqlitePool};

pub struct SyncQueueRepository;

impl SyncQueueRepository {
    /// Enqueue a new sync job tagged with user_id, returns its id.
    /// `user_id` is required (privacy isolation between accounts).
    ///
    /// Genérico sobre `Executor` para poder encolar tanto contra un `&SqlitePool`
    /// (uso normal) como contra una `&mut Transaction` (encolado atómico de un grafo
    /// de jobs — ver `scheduled_recording::service::enqueue_cloud_sync_jobs`). Así el
    /// worker nunca observa un outbox a medias (p.ej. `save_conversation` sin sus
    /// `save_transcript_segments`). `&SqlitePool` y `&mut SqliteConnection` implementan
    /// `Executor`, así que los callers existentes que pasan `&pool` no cambian.
    pub async fn enqueue<'e, E>(
        executor: E,
        job_type: &str,
        meeting_id: &str,
        payload: &str,
        max_attempts: i64,
        depends_on: Option<i64>,
        user_id: &str,
    ) -> Result<i64, SqlxError>
    where
        E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
    {
        let result = sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, max_attempts, depends_on, user_id)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(job_type)
        .bind(meeting_id)
        .bind(payload)
        .bind(max_attempts)
        .bind(depends_on)
        .bind(user_id)
        .execute(executor)
        .await?;

        Ok(result.last_insert_rowid())
    }

    /// Get jobs ready for processing for the given user:
    /// - status = 'pending'
    /// - user_id = ? (privacy isolation — only the current user's jobs)
    /// - next_retry_at is NULL or <= now
    /// - dependency is NULL or completed
    /// - la dependencia NO está 'failed' (defensa: si el padre murió, el hijo
    ///   nunca podrá ejecutarse; `fail_dependents` ya lo marca 'failed' en
    ///   cascada, pero esta condición cubre jobs de instalaciones viejas que
    ///   quedaron colgados antes de existir la cascada).
    pub async fn get_ready_jobs(
        pool: &SqlitePool,
        limit: i64,
        user_id: &str,
    ) -> Result<Vec<SyncQueueJob>, SqlxError> {
        sqlx::query_as::<_, SyncQueueJob>(
            "SELECT sq.* FROM sync_queue sq
             WHERE sq.status = 'pending'
               AND sq.user_id = ?
               AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= datetime('now'))
               AND (sq.depends_on IS NULL
                    OR EXISTS (SELECT 1 FROM sync_queue dep WHERE dep.id = sq.depends_on AND dep.status = 'completed'))
               AND NOT EXISTS (SELECT 1 FROM sync_queue dep WHERE dep.id = sq.depends_on AND dep.status = 'failed')
             ORDER BY sq.id ASC
             LIMIT ?",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Claim a job for processing (set status to in_progress) y fijar su lease.
    ///
    /// `AND status = 'pending'` es el MUTEX del claim — nunca relajarlo.
    /// `lease_secs` define hasta cuándo el claim se considera vivo: si el
    /// ejecutor muere entre claim y complete, `reset_stale_jobs` devuelve el
    /// job a 'pending' al vencer el lease (antes quedaba 'in_progress' eterno).
    /// Trabajos largos (finalize) deben extenderlo con `heartbeat_job`.
    pub async fn claim_job(pool: &SqlitePool, id: i64, lease_secs: i64) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               status = 'in_progress',
               lease_expires_at = datetime('now', '+' || ? || ' seconds'),
               updated_at = datetime('now')
             WHERE id = ? AND status = 'pending'",
        )
        .bind(lease_secs)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Extiende el lease de un job en ejecución. Solo aplica a 'in_progress':
    /// si el job ya fue completado/fallado/reseteado devuelve false y el
    /// ejecutor sabe que perdió la propiedad.
    pub async fn heartbeat_job(
        pool: &SqlitePool,
        id: i64,
        lease_secs: i64,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               lease_expires_at = datetime('now', '+' || ? || ' seconds'),
               updated_at = datetime('now')
             WHERE id = ? AND status = 'in_progress'",
        )
        .bind(lease_secs)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Mark a job as completed with optional result data
    pub async fn complete_job(
        pool: &SqlitePool,
        id: i64,
        result_data: Option<&str>,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET status = 'completed', result_data = ?, completed_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(result_data)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Mark a job as failed. If attempts exhausted, set status='failed'; otherwise stay 'pending' with next_retry_at.
    ///
    /// Al agotar los intentos se propaga el fallo a la descendencia
    /// (`fail_dependents`): un padre muerto deja a sus hijos esperando una
    /// dependencia que jamás va a completarse, y esos jobs quedaban 'pending'
    /// para siempre alimentando el badge "Sincronizando…".
    pub async fn fail_job(
        pool: &SqlitePool,
        id: i64,
        error_msg: &str,
        next_retry_at: Option<&str>,
    ) -> Result<bool, SqlxError> {
        // First increment attempt_count and check if exhausted
        let result = sqlx::query(
            "UPDATE sync_queue SET
               attempt_count = attempt_count + 1,
               last_error = ?,
               status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
               next_retry_at = CASE WHEN attempt_count + 1 >= max_attempts THEN NULL ELSE ? END,
               lease_expires_at = NULL,
               updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(error_msg)
        .bind(next_retry_at)
        .bind(id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(false);
        }

        // ¿La transición fue terminal? Solo entonces se propaga la cascada.
        let status: Option<(String,)> = sqlx::query_as("SELECT status FROM sync_queue WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

        if status.as_ref().map(|s| s.0.as_str()) == Some("failed") {
            Self::fail_dependents(pool, id, &format!("dependency_failed: {}", error_msg)).await?;
        }

        Ok(true)
    }

    /// Marca 'failed' a TODA la descendencia (hijos, nietos, …) de `root_id`
    /// que siga en 'pending'/'in_progress'. Los jobs ya 'completed'/'failed'
    /// no se tocan.
    ///
    /// El grafo de sync es una cadena (save_conversation → save_transcript_segments
    /// → finalize_conversation), así que el `WITH RECURSIVE` recorre por
    /// `depends_on` sin modificar esa columna: la CTE es estable durante el UPDATE.
    pub async fn fail_dependents(
        pool: &SqlitePool,
        root_id: i64,
        reason: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "WITH RECURSIVE descendants(id) AS (
                 SELECT id FROM sync_queue WHERE depends_on = ?
                 UNION
                 SELECT sq.id FROM sync_queue sq
                 JOIN descendants d ON sq.depends_on = d.id
             )
             UPDATE sync_queue SET
               status = 'failed',
               last_error = ?,
               next_retry_at = NULL,
               lease_expires_at = NULL,
               updated_at = datetime('now')
             WHERE id IN (SELECT id FROM descendants)
               AND status IN ('pending', 'in_progress')",
        )
        .bind(root_id)
        .bind(reason)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Falla un job de forma PERMANENTE sin quemar intentos: para errores que
    /// reintentar no arregla (`not_found:`, `validation:`). Propaga la cascada
    /// igual que `fail_job` al agotar intentos.
    pub async fn fail_job_permanent(
        pool: &SqlitePool,
        id: i64,
        error_msg: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               status = 'failed',
               last_error = ?,
               next_retry_at = NULL,
               lease_expires_at = NULL,
               updated_at = datetime('now')
             WHERE id = ? AND status IN ('pending', 'in_progress')",
        )
        .bind(error_msg)
        .bind(id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(false);
        }

        Self::fail_dependents(pool, id, &format!("dependency_failed: {}", error_msg)).await?;

        Ok(true)
    }

    /// Defer an in-progress job back to 'pending' with a future next_retry_at,
    /// WITHOUT incrementing attempt_count. Used when the cloud rejects by plan
    /// quota (error `quota:`): it is not a failure, the job must simply wait
    /// until the next quota period. next_retry_at must be SQLite format
    /// 'YYYY-MM-DD HH:MM:SS' (UTC) — get_ready_jobs compares strings against
    /// datetime('now'), so ISO-8601 with 'T' would sort after same-day times.
    pub async fn defer_job(
        pool: &SqlitePool,
        id: i64,
        next_retry_at: &str,
        last_error: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               status = 'pending',
               next_retry_at = ?,
               last_error = ?,
               updated_at = datetime('now')
             WHERE id = ? AND status = 'in_progress'",
        )
        .bind(next_retry_at)
        .bind(last_error)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Get sync status summary for a specific meeting
    pub async fn get_meeting_sync_status(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingSyncStatus>, SqlxError> {
        let row = sqlx::query_as::<_, MeetingSyncStatus>(
            "SELECT
               meeting_id,
               COUNT(*) as total_jobs,
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
               SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
             FROM sync_queue
             WHERE meeting_id = ?
             GROUP BY meeting_id",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        Ok(row)
    }

    /// Get sync status for all meetings owned by `user_id` that have pending/in_progress/failed jobs.
    pub async fn get_all_sync_statuses(
        pool: &SqlitePool,
        user_id: &str,
    ) -> Result<Vec<MeetingSyncStatus>, SqlxError> {
        sqlx::query_as::<_, MeetingSyncStatus>(
            "SELECT
               meeting_id,
               COUNT(*) as total_jobs,
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
               SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
             FROM sync_queue
             WHERE user_id = ?
             GROUP BY meeting_id",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
    }

    /// Devuelve a 'pending' los jobs 'in_progress' abandonados.
    ///
    /// Dos caminos, para ser compatible hacia atrás:
    /// - con lease (`claim_job` moderno): vence cuando `lease_expires_at <= now`.
    /// - legacy (`lease_expires_at IS NULL`, jobs claimeados por binarios
    ///   anteriores a la migración `20260812000000`): se cae al criterio viejo
    ///   por `updated_at` con `stale_seconds`.
    pub async fn reset_stale_jobs(
        pool: &SqlitePool,
        stale_seconds: i64,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               status = 'pending',
               lease_expires_at = NULL,
               updated_at = datetime('now')
             WHERE status = 'in_progress'
               AND ((lease_expires_at IS NOT NULL AND lease_expires_at <= datetime('now'))
                    OR (lease_expires_at IS NULL AND updated_at <= datetime('now', '-' || ? || ' seconds')))",
        )
        .bind(stale_seconds)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get the result_data of a job's dependency
    pub async fn get_dependency_result(
        pool: &SqlitePool,
        job_id: i64,
    ) -> Result<Option<String>, SqlxError> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT dep.result_data
             FROM sync_queue sq
             JOIN sync_queue dep ON dep.id = sq.depends_on
             WHERE sq.id = ?",
        )
        .bind(job_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.and_then(|r| r.0))
    }

    /// Cancel all pending/in_progress jobs for a meeting
    pub async fn cancel_jobs_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "DELETE FROM sync_queue WHERE meeting_id = ? AND status IN ('pending', 'in_progress')",
        )
        .bind(meeting_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Delete all sync_queue entries for a meeting (used in cascade delete)
    pub async fn delete_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query("DELETE FROM sync_queue WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected())
    }

    /// Reintento manual: devuelve a 'pending' TODOS los jobs 'failed' de un
    /// meeting, con el contador de intentos a cero y sin error pegado.
    ///
    /// Cubre también a los hijos marcados por `fail_dependents`
    /// (`dependency_failed: …`): sin ellos el padre revivido volvería a
    /// completarse y la cadena seguiría muerta a partir del segundo eslabón.
    /// El orden de ejecución lo sigue imponiendo `depends_on` en
    /// `get_ready_jobs`, así que revivir la cadena entera de golpe es seguro.
    ///
    /// Scoped por `user_id` igual que `get_ready_jobs`: revivir un job de otra
    /// cuenta no serviría de nada (el worker nunca lo tomaría).
    pub async fn retry_failed_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
        user_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET
               status = 'pending',
               attempt_count = 0,
               next_retry_at = NULL,
               lease_expires_at = NULL,
               last_error = NULL,
               updated_at = datetime('now')
             WHERE meeting_id = ? AND user_id = ? AND status = 'failed'",
        )
        .bind(meeting_id)
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get a single job by its ID (any status)
    pub async fn get_job_by_id(
        pool: &SqlitePool,
        id: i64,
    ) -> Result<Option<SyncQueueJob>, SqlxError> {
        sqlx::query_as::<_, SyncQueueJob>(
            "SELECT * FROM sync_queue WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    /// Clean up old completed jobs (older than N days)
    pub async fn cleanup_old_completed(
        pool: &SqlitePool,
        days: i64,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "DELETE FROM sync_queue WHERE status = 'completed' AND completed_at <= datetime('now', '-' || ? || ' days')",
        )
        .bind(days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get result_data from a completed finalize_conversation job for a meeting.
    /// Used to recover the Supabase conversation_id when DOM events were missed.
    pub async fn get_completed_finalize_result(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<String>, SqlxError> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT result_data FROM sync_queue
             WHERE meeting_id = ? AND job_type = 'finalize_conversation' AND status = 'completed'
             LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.and_then(|r| r.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    const SCHEMA: &str = r#"
        CREATE TABLE sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_type TEXT NOT NULL,
            meeting_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 10,
            next_retry_at TEXT,
            last_error TEXT,
            depends_on INTEGER,
            result_data TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            user_id TEXT,
            -- migración 20260812000000_sync_queue_lease
            lease_expires_at TEXT,
            FOREIGN KEY (depends_on) REFERENCES sync_queue(id) ON DELETE SET NULL
        );
    "#;

    const TEST_USER: &str = "test-user-id";
    /// Lease por defecto de los tests (mismo default que `sync_queue_claim_job`).
    const TEST_LEASE: i64 = 300;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query(SCHEMA).execute(&pool).await.expect("schema");
        pool
    }

    #[tokio::test]
    async fn enqueue_returns_autoincrement_id() {
        let pool = setup_pool().await;
        let id1 = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let id2 = SyncQueueRepository::enqueue(&pool, "save_transcript_segments", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        assert!(id2 > id1);
    }

    #[tokio::test]
    async fn get_ready_jobs_returns_pending_without_deps() {
        let pool = setup_pool().await;
        SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "pending");
    }

    #[tokio::test]
    async fn get_ready_jobs_skips_jobs_with_uncompleted_deps() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();

        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, parent);
    }

    #[tokio::test]
    async fn get_ready_jobs_includes_child_after_parent_completes() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(&pool, parent, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, parent, Some(r#"{"conversation_id":"abc"}"#))
            .await
            .unwrap();

        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, child);
    }

    #[tokio::test]
    async fn claim_job_transitions_from_pending_to_in_progress() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        assert!(SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap());
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "in_progress");
    }

    #[tokio::test]
    async fn claim_job_is_idempotent_returns_false_second_time() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        assert!(SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap());
        assert!(!SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap());
    }

    #[tokio::test]
    async fn complete_job_sets_status_and_result() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, id, Some(r#"{"ok":true}"#)).await.unwrap();
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "completed");
        assert_eq!(job.result_data.as_deref(), Some(r#"{"ok":true}"#));
        assert!(job.completed_at.is_some());
    }

    #[tokio::test]
    async fn fail_job_increments_attempts_and_stays_pending_until_max() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();

        SyncQueueRepository::fail_job(&pool, id, "first", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.attempt_count, 1);
        assert_eq!(job.status, "pending");
        assert_eq!(job.last_error.as_deref(), Some("first"));
    }

    #[tokio::test]
    async fn fail_job_transitions_to_failed_on_max_attempts() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 2, None, TEST_USER)
            .await
            .unwrap();

        SyncQueueRepository::fail_job(&pool, id, "e1", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();
        SyncQueueRepository::fail_job(&pool, id, "e2", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();

        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.attempt_count, 2);
        assert_eq!(job.status, "failed");
        assert_eq!(job.next_retry_at, None);
    }

    #[tokio::test]
    async fn defer_job_returns_to_pending_without_attempt_increment() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap();

        let deferred = SyncQueueRepository::defer_job(&pool, id, "2027-01-01 00:00:00", "quota:{}")
            .await
            .unwrap();
        assert!(deferred);

        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.attempt_count, 0);
        assert_eq!(job.next_retry_at.as_deref(), Some("2027-01-01 00:00:00"));
        assert_eq!(job.last_error.as_deref(), Some("quota:{}"));
    }

    #[tokio::test]
    async fn defer_job_only_applies_to_in_progress() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();

        // Job sigue 'pending' (nunca claimed) → defer no aplica
        let deferred = SyncQueueRepository::defer_job(&pool, id, "2027-01-01 00:00:00", "quota:{}")
            .await
            .unwrap();
        assert!(!deferred);

        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.next_retry_at, None);
    }

    #[tokio::test]
    async fn deferred_job_excluded_from_ready_until_retry_time() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();

        SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap();
        SyncQueueRepository::defer_job(&pool, id, "2099-01-01 00:00:00", "quota:{}")
            .await
            .unwrap();
        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert!(jobs.is_empty());

        // Con fecha pasada, el job despierta solo
        SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap();
        SyncQueueRepository::defer_job(&pool, id, "2020-01-01 00:00:00", "quota:{}")
            .await
            .unwrap();
        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, id);
    }

    #[tokio::test]
    async fn get_meeting_sync_status_aggregates_counts() {
        let pool = setup_pool().await;
        let a = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let _b = SyncQueueRepository::enqueue(&pool, "save_transcript_segments", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let c = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER).await.unwrap();

        SyncQueueRepository::claim_job(&pool, a, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, a, None).await.unwrap();
        SyncQueueRepository::claim_job(&pool, c, TEST_LEASE).await.unwrap();

        let status = SyncQueueRepository::get_meeting_sync_status(&pool, "m1")
            .await
            .unwrap()
            .expect("status row"); // get_meeting_sync_status doesn't filter by user_id (operates per meeting_id)
        assert_eq!(status.total_jobs, 3);
        assert_eq!(status.completed, 1);
        assert_eq!(status.in_progress, 1);
        assert_eq!(status.pending, 1);
        assert_eq!(status.failed, 0);
    }

    #[tokio::test]
    async fn get_dependency_result_returns_parent_result() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(&pool, parent, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, parent, Some(r#"{"id":"abc"}"#))
            .await
            .unwrap();

        let result = SyncQueueRepository::get_dependency_result(&pool, child).await.unwrap();
        assert_eq!(result.as_deref(), Some(r#"{"id":"abc"}"#));
    }

    #[tokio::test]
    async fn get_dependency_result_returns_none_without_dependency() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let result = SyncQueueRepository::get_dependency_result(&pool, id).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cancel_jobs_for_meeting_removes_pending_and_in_progress_only() {
        let pool = setup_pool().await;
        let pending = SyncQueueRepository::enqueue(&pool, "a", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let in_progress = SyncQueueRepository::enqueue(&pool, "b", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let completed = SyncQueueRepository::enqueue(&pool, "c", "m1", "{}", 3, None, TEST_USER).await.unwrap();

        SyncQueueRepository::claim_job(&pool, in_progress, TEST_LEASE).await.unwrap();
        SyncQueueRepository::claim_job(&pool, completed, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, completed, None).await.unwrap();

        let removed = SyncQueueRepository::cancel_jobs_for_meeting(&pool, "m1").await.unwrap();
        assert_eq!(removed, 2);

        assert!(SyncQueueRepository::get_job_by_id(&pool, pending).await.unwrap().is_none());
        assert!(SyncQueueRepository::get_job_by_id(&pool, in_progress).await.unwrap().is_none());
        assert!(SyncQueueRepository::get_job_by_id(&pool, completed).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn delete_by_meeting_removes_all_regardless_of_status() {
        let pool = setup_pool().await;
        SyncQueueRepository::enqueue(&pool, "a", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let completed = SyncQueueRepository::enqueue(&pool, "b", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        SyncQueueRepository::enqueue(&pool, "c", "m2", "{}", 3, None, TEST_USER).await.unwrap();

        SyncQueueRepository::claim_job(&pool, completed, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, completed, None).await.unwrap();

        let removed = SyncQueueRepository::delete_by_meeting(&pool, "m1").await.unwrap();
        assert_eq!(removed, 2);

        let remaining = SyncQueueRepository::get_all_sync_statuses(&pool, TEST_USER).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].meeting_id, "m2");
    }

    #[tokio::test]
    async fn get_completed_finalize_result_returns_only_completed_finalize() {
        let pool = setup_pool().await;
        let other = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, other, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, other, Some(r#"{"not":"this"}"#)).await.unwrap();

        // pending finalize — should not be returned
        SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        let none = SyncQueueRepository::get_completed_finalize_result(&pool, "m1").await.unwrap();
        assert!(none.is_none());

        // completed finalize — should be returned
        let finalize = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, finalize, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, finalize, Some(r#"{"conversation_id":"x"}"#))
            .await
            .unwrap();

        let result = SyncQueueRepository::get_completed_finalize_result(&pool, "m1").await.unwrap();
        assert_eq!(result.as_deref(), Some(r#"{"conversation_id":"x"}"#));
    }

    // ---------- lease ----------

    #[tokio::test]
    async fn claim_job_sets_lease_expiration() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        assert!(SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap());

        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "in_progress");
        let lease = job.lease_expires_at.expect("lease seteado por claim_job");

        // El lease debe caer en el futuro (comparación de strings sirve: ambos
        // vienen del formato 'YYYY-MM-DD HH:MM:SS' de SQLite).
        let (now,): (String,) = sqlx::query_as("SELECT datetime('now')")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(lease > now, "lease {} deberia ser futuro respecto a {}", lease, now);
    }

    #[tokio::test]
    async fn heartbeat_job_extends_lease_only_while_in_progress() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();

        // Sin claim previo no hay nada que extender
        assert!(!SyncQueueRepository::heartbeat_job(&pool, id, TEST_LEASE).await.unwrap());

        SyncQueueRepository::claim_job(&pool, id, 1).await.unwrap();
        let short = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap().lease_expires_at.unwrap();

        assert!(SyncQueueRepository::heartbeat_job(&pool, id, 3600).await.unwrap());
        let extended = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap().lease_expires_at.unwrap();
        assert!(extended > short, "heartbeat deberia empujar el lease ({} > {})", extended, short);
    }

    #[tokio::test]
    async fn reset_stale_revives_job_with_expired_lease() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, id, TEST_LEASE).await.unwrap();
        // Lease vencido con updated_at RECIENTE → solo el lease decide
        // (el camino legacy por updated_at no lo consideraría stale).
        sqlx::query(
            "UPDATE sync_queue SET lease_expires_at = datetime('now', '-10 seconds'),
             updated_at = datetime('now') WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let reset = SyncQueueRepository::reset_stale_jobs(&pool, 300).await.unwrap();
        assert_eq!(reset, 1);

        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.lease_expires_at, None);
        assert_eq!(job.attempt_count, 0, "reset_stale no quema intentos");
    }

    #[tokio::test]
    async fn reset_stale_keeps_job_with_live_lease() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, id, 3600).await.unwrap();

        // stale_seconds=0 dejaría stale a cualquier job por el camino legacy;
        // el lease vivo debe protegerlo.
        let reset = SyncQueueRepository::reset_stale_jobs(&pool, 0).await.unwrap();
        assert_eq!(reset, 0);
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "in_progress");
    }

    #[tokio::test]
    async fn reset_stale_falls_back_to_updated_at_for_legacy_jobs() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None, TEST_USER)
            .await
            .unwrap();
        // Job claimeado por un binario viejo: in_progress, sin lease, updated_at antiguo
        sqlx::query(
            "UPDATE sync_queue SET status = 'in_progress', lease_expires_at = NULL,
             updated_at = datetime('now', '-1 hour') WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let reset = SyncQueueRepository::reset_stale_jobs(&pool, 300).await.unwrap();
        assert_eq!(reset, 1);
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
    }

    // ---------- cascada de fallo ----------

    /// Cadena real del outbox: save_conversation → save_transcript_segments → finalize.
    async fn enqueue_chain(pool: &SqlitePool) -> (i64, i64, i64) {
        let parent = SyncQueueRepository::enqueue(pool, "save_conversation", "m1", "{}", 2, None, TEST_USER)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            pool,
            "save_transcript_segments",
            "m1",
            "{}",
            2,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();
        let grandchild = SyncQueueRepository::enqueue(
            pool,
            "finalize_conversation",
            "m1",
            "{}",
            2,
            Some(child),
            TEST_USER,
        )
        .await
        .unwrap();
        (parent, child, grandchild)
    }

    #[tokio::test]
    async fn fail_job_cascades_to_children_and_grandchildren_on_max_attempts() {
        let pool = setup_pool().await;
        let (parent, child, grandchild) = enqueue_chain(&pool).await;

        // Primer fallo: sigue pending, la descendencia intacta
        SyncQueueRepository::fail_job(&pool, parent, "boom", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, child).await.unwrap().unwrap().status,
            "pending"
        );

        // Segundo fallo: agota max_attempts=2 → cascada
        SyncQueueRepository::fail_job(&pool, parent, "boom", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();

        let p = SyncQueueRepository::get_job_by_id(&pool, parent).await.unwrap().unwrap();
        let c = SyncQueueRepository::get_job_by_id(&pool, child).await.unwrap().unwrap();
        let g = SyncQueueRepository::get_job_by_id(&pool, grandchild).await.unwrap().unwrap();
        assert_eq!(p.status, "failed");
        assert_eq!(c.status, "failed");
        assert_eq!(g.status, "failed", "el nieto tambien debe morir");
        assert!(c.last_error.as_deref().unwrap().starts_with("dependency_failed:"));
        assert_eq!(c.attempt_count, 0, "la cascada no inventa intentos");
    }

    #[tokio::test]
    async fn fail_dependents_leaves_completed_jobs_untouched() {
        let pool = setup_pool().await;
        let (parent, child, grandchild) = enqueue_chain(&pool).await;
        SyncQueueRepository::claim_job(&pool, child, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, child, Some(r#"{"ok":true}"#)).await.unwrap();

        let affected = SyncQueueRepository::fail_dependents(&pool, parent, "dependency_failed: x")
            .await
            .unwrap();
        assert_eq!(affected, 1, "solo el nieto pendiente");

        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, child).await.unwrap().unwrap().status,
            "completed"
        );
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, grandchild).await.unwrap().unwrap().status,
            "failed"
        );
    }

    #[tokio::test]
    async fn fail_job_permanent_does_not_touch_attempt_count_and_cascades() {
        let pool = setup_pool().await;
        let (parent, child, grandchild) = enqueue_chain(&pool).await;
        SyncQueueRepository::claim_job(&pool, parent, TEST_LEASE).await.unwrap();

        assert!(SyncQueueRepository::fail_job_permanent(&pool, parent, "not_found: meeting")
            .await
            .unwrap());

        let p = SyncQueueRepository::get_job_by_id(&pool, parent).await.unwrap().unwrap();
        assert_eq!(p.status, "failed");
        assert_eq!(p.attempt_count, 0, "permanent no quema intentos");
        assert_eq!(p.next_retry_at, None);
        assert_eq!(p.lease_expires_at, None);

        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, child).await.unwrap().unwrap().status,
            "failed"
        );
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, grandchild).await.unwrap().unwrap().status,
            "failed"
        );

        // Idempotente: un job ya 'failed' no vuelve a aplicar
        assert!(!SyncQueueRepository::fail_job_permanent(&pool, parent, "not_found: meeting")
            .await
            .unwrap());
    }

    // ---------- reintento manual ----------

    #[tokio::test]
    async fn retry_failed_for_meeting_revives_whole_failed_chain() {
        let pool = setup_pool().await;
        let (parent, child, grandchild) = enqueue_chain(&pool).await;

        // Padre agota intentos → cascada: los 3 quedan 'failed'
        SyncQueueRepository::fail_job(&pool, parent, "network: down", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();
        SyncQueueRepository::fail_job(&pool, parent, "network: down", Some("2026-01-01 00:00:00"))
            .await
            .unwrap();

        let revived = SyncQueueRepository::retry_failed_for_meeting(&pool, "m1", TEST_USER)
            .await
            .unwrap();
        assert_eq!(revived, 3, "padre + hijo + nieto");

        for id in [parent, child, grandchild] {
            let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
            assert_eq!(job.status, "pending");
            assert_eq!(job.attempt_count, 0);
            assert_eq!(job.next_retry_at, None);
            assert_eq!(job.last_error, None);
        }

        // Y el padre vuelve a estar listo de inmediato
        let ready = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, parent);
    }

    #[tokio::test]
    async fn retry_failed_for_meeting_ignores_other_meetings_users_and_statuses() {
        let pool = setup_pool().await;
        let failed = SyncQueueRepository::enqueue(&pool, "a", "m1", "{}", 1, None, TEST_USER).await.unwrap();
        let completed = SyncQueueRepository::enqueue(&pool, "b", "m1", "{}", 3, None, TEST_USER).await.unwrap();
        let other_meeting = SyncQueueRepository::enqueue(&pool, "c", "m2", "{}", 1, None, TEST_USER).await.unwrap();
        let other_user = SyncQueueRepository::enqueue(&pool, "d", "m1", "{}", 1, None, "otro-user").await.unwrap();

        for id in [failed, other_meeting, other_user] {
            sqlx::query("UPDATE sync_queue SET status = 'failed', last_error = 'boom' WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        SyncQueueRepository::claim_job(&pool, completed, TEST_LEASE).await.unwrap();
        SyncQueueRepository::complete_job(&pool, completed, None).await.unwrap();

        let revived = SyncQueueRepository::retry_failed_for_meeting(&pool, "m1", TEST_USER)
            .await
            .unwrap();
        assert_eq!(revived, 1);

        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, completed).await.unwrap().unwrap().status,
            "completed",
            "un job completado no se re-encola"
        );
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, other_meeting).await.unwrap().unwrap().status,
            "failed"
        );
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, other_user).await.unwrap().unwrap().status,
            "failed"
        );
    }

    #[tokio::test]
    async fn get_ready_jobs_excludes_children_of_failed_dependency() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 1, None, TEST_USER)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();

        // Se marca failed SOLO el padre (simula una instalación vieja, sin cascada)
        sqlx::query("UPDATE sync_queue SET status = 'failed' WHERE id = ?")
            .bind(parent)
            .execute(&pool)
            .await
            .unwrap();

        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER).await.unwrap();
        assert!(
            jobs.iter().all(|j| j.id != child),
            "un hijo con dependencia failed nunca esta listo"
        );
        assert!(jobs.is_empty());
    }
}
