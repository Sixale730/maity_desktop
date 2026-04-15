use crate::database::models::{MeetingSyncStatus, SyncQueueJob};
use sqlx::{Error as SqlxError, SqlitePool};

pub struct SyncQueueRepository;

impl SyncQueueRepository {
    /// Enqueue a new sync job, returns its id
    pub async fn enqueue(
        pool: &SqlitePool,
        job_type: &str,
        meeting_id: &str,
        payload: &str,
        max_attempts: i64,
        depends_on: Option<i64>,
    ) -> Result<i64, SqlxError> {
        let result = sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, max_attempts, depends_on)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(job_type)
        .bind(meeting_id)
        .bind(payload)
        .bind(max_attempts)
        .bind(depends_on)
        .execute(pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    /// Get jobs ready for processing:
    /// - status = 'pending'
    /// - next_retry_at is NULL or <= now
    /// - dependency is NULL or completed
    pub async fn get_ready_jobs(
        pool: &SqlitePool,
        limit: i64,
    ) -> Result<Vec<SyncQueueJob>, SqlxError> {
        sqlx::query_as::<_, SyncQueueJob>(
            "SELECT sq.* FROM sync_queue sq
             WHERE sq.status = 'pending'
               AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= datetime('now'))
               AND (sq.depends_on IS NULL
                    OR EXISTS (SELECT 1 FROM sync_queue dep WHERE dep.id = sq.depends_on AND dep.status = 'completed'))
             ORDER BY sq.id ASC
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Claim a job for processing (set status to in_progress)
    pub async fn claim_job(pool: &SqlitePool, id: i64) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET status = 'in_progress', updated_at = datetime('now')
             WHERE id = ? AND status = 'pending'",
        )
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
               updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(error_msg)
        .bind(next_retry_at)
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

    /// Get sync status for all meetings that have pending/in_progress/failed jobs
    pub async fn get_all_sync_statuses(
        pool: &SqlitePool,
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
             GROUP BY meeting_id",
        )
        .fetch_all(pool)
        .await
    }

    /// Reset stale jobs that have been in_progress for more than stale_seconds
    pub async fn reset_stale_jobs(
        pool: &SqlitePool,
        stale_seconds: i64,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "UPDATE sync_queue SET status = 'pending', updated_at = datetime('now')
             WHERE status = 'in_progress'
               AND updated_at <= datetime('now', '-' || ? || ' seconds')",
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
            FOREIGN KEY (depends_on) REFERENCES sync_queue(id) ON DELETE SET NULL
        );
    "#;

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
        let id1 = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let id2 = SyncQueueRepository::enqueue(&pool, "save_transcript_segments", "m1", "{}", 3, None)
            .await
            .unwrap();
        assert!(id2 > id1);
    }

    #[tokio::test]
    async fn get_ready_jobs_returns_pending_without_deps() {
        let pool = setup_pool().await;
        SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "pending");
    }

    #[tokio::test]
    async fn get_ready_jobs_skips_jobs_with_uncompleted_deps() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
        )
        .await
        .unwrap();

        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, parent);
    }

    #[tokio::test]
    async fn get_ready_jobs_includes_child_after_parent_completes() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(&pool, parent).await.unwrap();
        SyncQueueRepository::complete_job(&pool, parent, Some(r#"{"conversation_id":"abc"}"#))
            .await
            .unwrap();

        let jobs = SyncQueueRepository::get_ready_jobs(&pool, 10).await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, child);
    }

    #[tokio::test]
    async fn claim_job_transitions_from_pending_to_in_progress() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        assert!(SyncQueueRepository::claim_job(&pool, id).await.unwrap());
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "in_progress");
    }

    #[tokio::test]
    async fn claim_job_is_idempotent_returns_false_second_time() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        assert!(SyncQueueRepository::claim_job(&pool, id).await.unwrap());
        assert!(!SyncQueueRepository::claim_job(&pool, id).await.unwrap());
    }

    #[tokio::test]
    async fn complete_job_sets_status_and_result() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, id).await.unwrap();
        SyncQueueRepository::complete_job(&pool, id, Some(r#"{"ok":true}"#)).await.unwrap();
        let job = SyncQueueRepository::get_job_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "completed");
        assert_eq!(job.result_data.as_deref(), Some(r#"{"ok":true}"#));
        assert!(job.completed_at.is_some());
    }

    #[tokio::test]
    async fn fail_job_increments_attempts_and_stays_pending_until_max() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
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
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 2, None)
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
    async fn get_meeting_sync_status_aggregates_counts() {
        let pool = setup_pool().await;
        let a = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None).await.unwrap();
        let _b = SyncQueueRepository::enqueue(&pool, "save_transcript_segments", "m1", "{}", 3, None).await.unwrap();
        let c = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None).await.unwrap();

        SyncQueueRepository::claim_job(&pool, a).await.unwrap();
        SyncQueueRepository::complete_job(&pool, a, None).await.unwrap();
        SyncQueueRepository::claim_job(&pool, c).await.unwrap();

        let status = SyncQueueRepository::get_meeting_sync_status(&pool, "m1")
            .await
            .unwrap()
            .expect("status row");
        assert_eq!(status.total_jobs, 3);
        assert_eq!(status.completed, 1);
        assert_eq!(status.in_progress, 1);
        assert_eq!(status.pending, 1);
        assert_eq!(status.failed, 0);
    }

    #[tokio::test]
    async fn get_dependency_result_returns_parent_result() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            "finalize_conversation",
            "m1",
            "{}",
            3,
            Some(parent),
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(&pool, parent).await.unwrap();
        SyncQueueRepository::complete_job(&pool, parent, Some(r#"{"id":"abc"}"#))
            .await
            .unwrap();

        let result = SyncQueueRepository::get_dependency_result(&pool, child).await.unwrap();
        assert_eq!(result.as_deref(), Some(r#"{"id":"abc"}"#));
    }

    #[tokio::test]
    async fn get_dependency_result_returns_none_without_dependency() {
        let pool = setup_pool().await;
        let id = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let result = SyncQueueRepository::get_dependency_result(&pool, id).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cancel_jobs_for_meeting_removes_pending_and_in_progress_only() {
        let pool = setup_pool().await;
        let pending = SyncQueueRepository::enqueue(&pool, "a", "m1", "{}", 3, None).await.unwrap();
        let in_progress = SyncQueueRepository::enqueue(&pool, "b", "m1", "{}", 3, None).await.unwrap();
        let completed = SyncQueueRepository::enqueue(&pool, "c", "m1", "{}", 3, None).await.unwrap();

        SyncQueueRepository::claim_job(&pool, in_progress).await.unwrap();
        SyncQueueRepository::claim_job(&pool, completed).await.unwrap();
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
        SyncQueueRepository::enqueue(&pool, "a", "m1", "{}", 3, None).await.unwrap();
        let completed = SyncQueueRepository::enqueue(&pool, "b", "m1", "{}", 3, None).await.unwrap();
        SyncQueueRepository::enqueue(&pool, "c", "m2", "{}", 3, None).await.unwrap();

        SyncQueueRepository::claim_job(&pool, completed).await.unwrap();
        SyncQueueRepository::complete_job(&pool, completed, None).await.unwrap();

        let removed = SyncQueueRepository::delete_by_meeting(&pool, "m1").await.unwrap();
        assert_eq!(removed, 2);

        let remaining = SyncQueueRepository::get_all_sync_statuses(&pool).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].meeting_id, "m2");
    }

    #[tokio::test]
    async fn get_completed_finalize_result_returns_only_completed_finalize() {
        let pool = setup_pool().await;
        let other = SyncQueueRepository::enqueue(&pool, "save_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, other).await.unwrap();
        SyncQueueRepository::complete_job(&pool, other, Some(r#"{"not":"this"}"#)).await.unwrap();

        // pending finalize — should not be returned
        SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        let none = SyncQueueRepository::get_completed_finalize_result(&pool, "m1").await.unwrap();
        assert!(none.is_none());

        // completed finalize — should be returned
        let finalize = SyncQueueRepository::enqueue(&pool, "finalize_conversation", "m1", "{}", 3, None)
            .await
            .unwrap();
        SyncQueueRepository::claim_job(&pool, finalize).await.unwrap();
        SyncQueueRepository::complete_job(&pool, finalize, Some(r#"{"conversation_id":"x"}"#))
            .await
            .unwrap();

        let result = SyncQueueRepository::get_completed_finalize_result(&pool, "m1").await.unwrap();
        assert_eq!(result.as_deref(), Some(r#"{"conversation_id":"x"}"#));
    }
}
