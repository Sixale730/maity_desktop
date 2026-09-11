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
    ///
    /// `process_id` = `process_session_id()` del proceso que graba: es el
    /// discriminador de huérfanos del planner (`planner::is_orphan`) — una
    /// fila `recording` cuyo proceso no es el actual está huérfana. Se
    /// re-sella también en el conflicto: si no, un re-arranque sobre la misma
    /// carpeta conservaría un pid viejo y el planner reclamaría la fila VIVA
    /// como ajena.
    pub async fn upsert_recording(
        pool: &SqlitePool,
        folder_path: &str,
        meeting_local_id: Option<&str>,
        segment_started_at: Option<&str>,
        trigger_kind: &str,
        user_id: &str,
        process_id: &str,
    ) -> Result<i64, SqlxError> {
        sqlx::query(
            "INSERT INTO batch_transcription_queue
               (folder_path, meeting_local_id, segment_started_at, trigger_kind, status, user_id, process_id)
             VALUES (?, ?, ?, ?, 'recording', ?, ?)
             ON CONFLICT(folder_path) DO UPDATE SET
               meeting_local_id = excluded.meeting_local_id,
               segment_started_at = excluded.segment_started_at,
               trigger_kind = excluded.trigger_kind,
               status = 'recording',
               process_id = excluded.process_id,
               updated_at = datetime('now')",
        )
        .bind(folder_path)
        .bind(meeting_local_id)
        .bind(segment_started_at)
        .bind(trigger_kind)
        .bind(user_id)
        .bind(process_id)
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

    /// Filas `recording` (candidatas a recuperación post-crash). Sin filtro a
    /// propósito: el planner clasifica cada una con `is_orphan` (`process_id`
    /// + fase de grabación) y decide contra el estado del disco.
    pub async fn recording_rows(pool: &SqlitePool) -> Result<Vec<BatchQueueJob>, SqlxError> {
        sqlx::query_as::<_, BatchQueueJob>(
            "SELECT * FROM batch_transcription_queue WHERE status = 'recording' ORDER BY id ASC",
        )
        .fetch_all(pool)
        .await
    }

    /// Fallo del MERGE de checkpoints en la recuperación post-crash (planner):
    /// incrementa `attempts` sobre una fila `recording`; al agotar
    /// `max_attempts` pasa a `failed` (visible en la UI con "Reintentar"; el
    /// audio sigue en disco). Mientras no agota, la fila SIGUE en `recording`
    /// y la siguiente pasada del planner (≤ 5 min) la vuelve a intentar — un
    /// ffmpeg que aún no resuelve a los 120 s del arranque no condena la
    /// grabación. `fail` NO sirve aquí: su guarda es `status='processing'` y
    /// sobre `recording` afecta 0 filas (así una fila cuyo merge fallaba
    /// quedaba `recording` e invisible para siempre).
    pub async fn fail_recovery(
        pool: &SqlitePool,
        id: i64,
        error_msg: &str,
        max_attempts: i64,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               attempts = attempts + 1,
               last_error = ?,
               status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'recording' END,
               updated_at = datetime('now')
             WHERE id = ? AND status = 'recording'",
        )
        .bind(error_msg)
        .bind(max_attempts)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Recuperación post-crash: `recording` → `pending`. **Conserva el
    /// `trigger_kind` original** — el origen decide la política de descarte al
    /// finalizar (manual NUNCA descarta por umbral; sobreescribirlo con
    /// 'crash_recovery' le aplicaría MIN_SEGMENT_WORDS a una grabación manual
    /// recuperada). La marca de recuperación queda en `last_error`. `attempts`
    /// vuelve a cero: los intentos que consumió el merge (`fail_recovery`) no
    /// se cobran a la transcripción.
    pub async fn mark_crash_recovery(pool: &SqlitePool, id: i64) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'pending', last_error = 'crash_recovery', attempts = 0,
               updated_at = datetime('now')
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

    /// Filas VIVAS del usuario para el bloque "Transcripciones pendientes"
    /// de la lista (F4): `pending`, `processing` y `failed`. Excluye a
    /// propósito `recording` — una fila stale de un crash se vería como
    /// "Grabando" hasta la pasada de recuperación del planner (≤ 5 min:
    /// corre en cada despertar del loop, no solo al arranque) — y las
    /// terminales `done`/`discarded` (la reunión ya está en la lista o no
    /// existe). Más recientes primero, tope 50.
    pub async fn list_active(
        pool: &SqlitePool,
        user_id: &str,
    ) -> Result<Vec<BatchQueueJob>, SqlxError> {
        sqlx::query_as::<_, BatchQueueJob>(
            "SELECT * FROM batch_transcription_queue
             WHERE user_id = ? AND status IN ('pending', 'processing', 'failed')
             ORDER BY id DESC LIMIT 50",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
    }

    /// Reintento manual desde la UI: `failed` → `pending` con los intentos a
    /// cero y sin `last_error` (el planner vuelve a intentar desde limpio; el
    /// audio sigue en disco). Solo filas del usuario y solo `failed`: un
    /// `pending`/`processing` no se toca. Devuelve `false` si no había nada
    /// que revivir. El caller debe seguir con `planner::notify_enqueued()`.
    pub async fn retry_failed(
        pool: &SqlitePool,
        folder_path: &str,
        user_id: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE batch_transcription_queue SET
               status = 'pending', attempts = 0, last_error = NULL,
               updated_at = datetime('now')
             WHERE folder_path = ? AND user_id = ? AND status = 'failed'",
        )
        .bind(folder_path)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Espejo del SQL de las migraciones `20260909000000` + `20260911100000`
    /// (`process_id`) — mismo patrón que los tests de `sync_queue`.
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
            completed_at TEXT,
            process_id TEXT
        );
    "#;

    const TEST_USER: &str = "test-user";
    const TEST_PID: &str = "proc-1-aaaaaaaa";

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
        BatchQueueRepository::upsert_recording(
            pool,
            folder,
            None,
            Some("2026-09-09 09:00:00"),
            "rotation",
            TEST_USER,
            TEST_PID,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn upsert_sella_y_actualiza_process_id() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.process_id.as_deref(), Some(TEST_PID));

        // Re-arranque sobre la misma carpeta desde OTRO proceso: el pid se
        // re-sella (si no, el planner reclamaría la fila viva como ajena).
        let same = BatchQueueRepository::upsert_recording(
            &pool, "C:/rec/seg1", None, None, "manual", TEST_USER, "proc-2-bbbbbbbb",
        )
        .await
        .unwrap();
        assert_eq!(same, id);
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.process_id.as_deref(), Some("proc-2-bbbbbbbb"));
        assert_eq!(job.status, "recording");
    }

    #[tokio::test]
    async fn fail_es_noop_fuera_de_processing() {
        // Pinnea el defecto que dejaba huérfanos invisibles: `fail` sobre una
        // fila `recording` no toca nada (su guarda es `processing`).
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        assert!(!BatchQueueRepository::fail(&pool, id, "e", 5).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "recording");
        assert_eq!(job.attempts, 0);
        assert!(job.last_error.is_none());
    }

    #[tokio::test]
    async fn fail_recovery_reintenta_sobre_recording_y_agota_a_failed() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;

        assert!(BatchQueueRepository::fail_recovery(&pool, id, "e1", 2).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "recording", "sin agotar sigue en recording (la próxima pasada reintenta)");
        assert_eq!(job.attempts, 1);
        assert_eq!(job.last_error.as_deref(), Some("e1"));

        assert!(BatchQueueRepository::fail_recovery(&pool, id, "e2", 2).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "failed", "al agotar queda visible con Reintentar");
        assert_eq!(job.attempts, 2);
        assert_eq!(job.last_error.as_deref(), Some("e2"));

        // Terminal: no vuelve a tocarla. Y tampoco toca filas pending.
        assert!(!BatchQueueRepository::fail_recovery(&pool, id, "e3", 2).await.unwrap());
        let p = insert_recording(&pool, "C:/rec/seg2").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg2").await.unwrap();
        assert!(!BatchQueueRepository::fail_recovery(&pool, p, "x", 2).await.unwrap());
        assert_eq!(BatchQueueRepository::get_by_id(&pool, p).await.unwrap().unwrap().status, "pending");
    }

    #[tokio::test]
    async fn crash_recovery_resetea_attempts() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::fail_recovery(&pool, id, "ffmpeg", 5).await.unwrap();
        assert_eq!(BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap().attempts, 1);

        assert!(BatchQueueRepository::mark_crash_recovery(&pool, id).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.attempts, 0, "los intentos del merge no se cobran a la transcripción");
        assert_eq!(job.last_error.as_deref(), Some("crash_recovery"));
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
        // El ORIGEN se conserva: decide la política de descarte al finalizar.
        assert_eq!(job.trigger_kind, "rotation");
        assert_eq!(job.last_error.as_deref(), Some("crash_recovery"));
    }

    #[tokio::test]
    async fn next_pending_es_fifo_y_por_usuario() {
        let pool = setup_pool().await;
        let a = insert_recording(&pool, "C:/rec/seg1").await;
        let _b = insert_recording(&pool, "C:/rec/seg2").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg2").await.unwrap();
        // Fila de otro usuario, más vieja imposible (id mayor), no debe salir.
        BatchQueueRepository::upsert_recording(&pool, "C:/rec/otro", None, None, "manual", "otro-user", TEST_PID)
            .await
            .unwrap();
        BatchQueueRepository::mark_pending(&pool, "C:/rec/otro").await.unwrap();

        let next = BatchQueueRepository::next_pending(&pool, TEST_USER).await.unwrap().unwrap();
        assert_eq!(next.id, a, "FIFO: el más viejo primero");
        assert_eq!(BatchQueueRepository::pending_count(&pool, TEST_USER).await.unwrap(), 2);
    }

    // ── F4: list_active / retry_failed ──────────────────────────────────

    #[tokio::test]
    async fn list_active_excluye_terminales_recording_y_otros_usuarios() {
        let pool = setup_pool().await;
        // recording (stale de crash): NO debe salir.
        insert_recording(&pool, "C:/rec/recording").await;
        // pending
        insert_recording(&pool, "C:/rec/pending").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/pending").await.unwrap();
        // processing
        let p = insert_recording(&pool, "C:/rec/processing").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/processing").await.unwrap();
        BatchQueueRepository::claim(&pool, p).await.unwrap();
        // failed
        let f = insert_recording(&pool, "C:/rec/failed").await;
        BatchQueueRepository::fail_permanent(&pool, f, "folder_missing").await.unwrap();
        // done y discarded: terminales, NO deben salir.
        let d = insert_recording(&pool, "C:/rec/done").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/done").await.unwrap();
        BatchQueueRepository::claim(&pool, d).await.unwrap();
        BatchQueueRepository::complete(&pool, d, "done").await.unwrap();
        let x = insert_recording(&pool, "C:/rec/discarded").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/discarded").await.unwrap();
        BatchQueueRepository::claim(&pool, x).await.unwrap();
        BatchQueueRepository::complete(&pool, x, "discarded").await.unwrap();
        // pending de OTRO usuario: NO debe salir.
        BatchQueueRepository::upsert_recording(&pool, "C:/rec/otro", None, None, "manual", "otro-user", TEST_PID)
            .await
            .unwrap();
        BatchQueueRepository::mark_pending(&pool, "C:/rec/otro").await.unwrap();

        let rows = BatchQueueRepository::list_active(&pool, TEST_USER).await.unwrap();
        let folders: Vec<&str> = rows.iter().map(|r| r.folder_path.as_str()).collect();
        assert_eq!(
            folders,
            vec!["C:/rec/failed", "C:/rec/processing", "C:/rec/pending"],
            "solo pending|processing|failed del usuario, más recientes primero"
        );
    }

    #[tokio::test]
    async fn list_active_respeta_el_tope_de_50() {
        let pool = setup_pool().await;
        for i in 0..60 {
            let folder = format!("C:/rec/seg{:03}", i);
            insert_recording(&pool, &folder).await;
            BatchQueueRepository::mark_pending(&pool, &folder).await.unwrap();
        }
        let rows = BatchQueueRepository::list_active(&pool, TEST_USER).await.unwrap();
        assert_eq!(rows.len(), 50);
        assert_eq!(rows[0].folder_path, "C:/rec/seg059", "el más reciente primero");
    }

    #[tokio::test]
    async fn retry_failed_revive_y_resetea() {
        let pool = setup_pool().await;
        let id = insert_recording(&pool, "C:/rec/seg1").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/seg1").await.unwrap();
        // Agotar intentos: 2 fallos con max 2 → failed, attempts=2, last_error="e2".
        BatchQueueRepository::claim(&pool, id).await.unwrap();
        BatchQueueRepository::fail(&pool, id, "e1", 2).await.unwrap();
        BatchQueueRepository::claim(&pool, id).await.unwrap();
        BatchQueueRepository::fail(&pool, id, "e2", 2).await.unwrap();
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "failed");

        assert!(BatchQueueRepository::retry_failed(&pool, "C:/rec/seg1", TEST_USER).await.unwrap());
        let job = BatchQueueRepository::get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(job.status, "pending");
        assert_eq!(job.attempts, 0, "el reintento manual arranca desde limpio");
        assert!(job.last_error.is_none());
        // El planner puede volver a tomarlo.
        let next = BatchQueueRepository::next_pending(&pool, TEST_USER).await.unwrap().unwrap();
        assert_eq!(next.id, id);
    }

    #[tokio::test]
    async fn retry_failed_no_toca_pending_ni_processing_ni_otros_usuarios() {
        let pool = setup_pool().await;
        // pending
        let a = insert_recording(&pool, "C:/rec/pending").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/pending").await.unwrap();
        assert!(!BatchQueueRepository::retry_failed(&pool, "C:/rec/pending", TEST_USER).await.unwrap());
        assert_eq!(BatchQueueRepository::get_by_id(&pool, a).await.unwrap().unwrap().status, "pending");
        // processing
        let b = insert_recording(&pool, "C:/rec/processing").await;
        BatchQueueRepository::mark_pending(&pool, "C:/rec/processing").await.unwrap();
        BatchQueueRepository::claim(&pool, b).await.unwrap();
        assert!(!BatchQueueRepository::retry_failed(&pool, "C:/rec/processing", TEST_USER).await.unwrap());
        assert_eq!(BatchQueueRepository::get_by_id(&pool, b).await.unwrap().unwrap().status, "processing");
        // failed de otro usuario: aislamiento.
        BatchQueueRepository::upsert_recording(&pool, "C:/rec/otro", None, None, "manual", "otro-user", TEST_PID)
            .await
            .unwrap();
        let (c,): (i64,) = sqlx::query_as("SELECT id FROM batch_transcription_queue WHERE folder_path = 'C:/rec/otro'")
            .fetch_one(&pool)
            .await
            .unwrap();
        BatchQueueRepository::fail_permanent(&pool, c, "x").await.unwrap();
        assert!(!BatchQueueRepository::retry_failed(&pool, "C:/rec/otro", TEST_USER).await.unwrap());
        assert_eq!(BatchQueueRepository::get_by_id(&pool, c).await.unwrap().unwrap().status, "failed");
        // Carpeta inexistente.
        assert!(!BatchQueueRepository::retry_failed(&pool, "C:/rec/nada", TEST_USER).await.unwrap());
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
