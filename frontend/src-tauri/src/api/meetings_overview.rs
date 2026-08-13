//! `api_get_meetings_overview` — una sola llamada para pintar la lista de
//! Conversaciones sin mentir.
//!
//! Antes el frontend hacía `api_get_meetings` + N × `api_get_meeting_metadata`
//! y hardcodeaba `words_count`/`duration_seconds` a null, así que toda fila
//! local mostraba "0 palabras / Duración: --" aunque la transcripción ya
//! estuviera en SQLite. Además el badge "Sincronizando…" se derivaba de
//! `!communication_feedback_v4`, o sea que jamás se apagaba para una fila que
//! no llegó a fusionarse con la nube.
//!
//! Este comando devuelve, en 3 queries totales (meetings + agregados de
//! transcripts + estado de la cola), lo que la lista necesita para decir la
//! verdad: palabras, duración y el estado REAL del sync.
//!
//! Gotchas:
//! - Los agregados usan **JOIN** contra `meetings`, nunca `IN (?, ?, …)` con la
//!   lista de ids: SQLite topa en 999 variables por statement y un usuario con
//!   jornadas largas pasa ese número.
//! - El conteo de palabras se hace **en Rust** con `split_whitespace()`, mismo
//!   criterio que el payload que se manda a la nube
//!   (`scheduled_recording::service`): SQL puro no puede replicar esa semántica
//!   (espacios repetidos, tabs, tokens vacíos) y una lista que cuente distinto
//!   que la nube vuelve a mentir en cuanto la fila se fusiona.

use std::collections::HashMap;

use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, SqlitePool};
use tauri::{AppHandle, Runtime};

use crate::{database::repositories::meeting::MeetingsRepository, state::AppState};

/// Fila de la lista de Conversaciones (proyección local, sin datos de nube).
///
/// Serde snake_case como el resto de los comandos `api_*` (ver `MeetingMetadata`
/// en `api::models`) — el frontend lee `words_count`, no `wordsCount`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingOverview {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    /// Cloud dedup key (UUID v4) — la lista la usa para fusionar con la nube.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_idempotency_key: Option<String>,
    /// Palabras de la transcripción local (`split_whitespace`). 0 = sin transcripción.
    pub words_count: i64,
    /// `max(audio_end_time)` redondeado. 0 = sin timestamps de audio.
    pub duration_seconds: i64,
    /// `pending` | `in_progress` | `failed` | `completed` | `none`.
    pub sync_state: String,
    /// `last_error` del job failed más reciente (con su prefijo: `quota:`,
    /// `auth:`, `dependency_failed:`, …). Solo presente si `sync_state=failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_error: Option<String>,
    /// `analysis_status` que devolvió la nube en el finalize (`quota_skipped`,
    /// `pending`, `processing`, `completed`…), leído del `result_data` del job
    /// `finalize_conversation` completado. Aditivo: ausente cuando el finalize
    /// todavía no corrió o la respuesta no lo traía.
    ///
    /// Es la ÚNICA vía por la que la lista se entera de que el plan agotó la
    /// cuota: desde issue #132 la nube responde 200 con `quota_skipped`, así
    /// que el job queda `completed` y el `sync_state` no dice nada al respecto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_status: Option<String>,
}

/// Agregados de transcripción por meeting: `(words_count, duration_seconds)`.
///
/// Trae solo `(meeting_id, transcript, audio_end_time)` — nada de `SELECT *`,
/// que arrastraría `summary`/`key_points` de cada segmento.
pub async fn transcript_aggregates(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<HashMap<String, (i64, i64)>, SqlxError> {
    let rows: Vec<(String, String, Option<f64>)> = sqlx::query_as(
        "SELECT t.meeting_id, t.transcript, t.audio_end_time
         FROM transcripts t
         JOIN meetings m ON m.id = t.meeting_id
         WHERE m.user_id = ?",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // (palabras acumuladas, max audio_end_time)
    let mut acc: HashMap<String, (i64, f64)> = HashMap::new();
    for (meeting_id, transcript, audio_end_time) in rows {
        let entry = acc.entry(meeting_id).or_insert((0, 0.0));
        entry.0 += transcript.split_whitespace().count() as i64;
        let end = audio_end_time.unwrap_or(0.0);
        if end > entry.1 {
            entry.1 = end;
        }
    }

    Ok(acc
        .into_iter()
        .map(|(id, (words, max_end))| (id, (words, max_end.round() as i64)))
        .collect())
}

/// Prioridad de estados para resumir la cola de un meeting en UNA etiqueta:
/// cualquier `failed` manda sobre `in_progress`, que manda sobre `pending`,
/// que manda sobre `completed`. Se hace en SQL (`MAX(CASE …)`) para no traer
/// la cola entera a memoria.
const SYNC_RANK_SQL: &str = "MAX(CASE sq.status
        WHEN 'failed' THEN 4
        WHEN 'in_progress' THEN 3
        WHEN 'pending' THEN 2
        WHEN 'completed' THEN 1
        ELSE 0 END)";

fn rank_to_state(rank: i64) -> &'static str {
    match rank {
        4 => "failed",
        3 => "in_progress",
        2 => "pending",
        1 => "completed",
        _ => "none",
    }
}

/// Resumen de la cola de sync de UN meeting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncSummary {
    /// `pending` | `in_progress` | `failed` | `completed` (prioridad de `SYNC_RANK_SQL`).
    pub state: String,
    /// `last_error` del job failed más reciente. Solo con `state == "failed"`.
    pub error: Option<String>,
    /// `analysis_status` que dejó el finalize completado en su `result_data`.
    pub analysis_status: Option<String>,
}

/// `analysis_status` del `result_data` de un job finalize completado.
///
/// Se parsea en **Rust**, no con `json_extract` en SQL: el `result_data` es la
/// `FinalizeResponse` serializada tal cual (shape que decide la nube) y no
/// queremos atar la lista a que el build de SQLite traiga JSON1 habilitado.
fn analysis_status_from_result(raw: Option<String>) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(&raw?).ok()?;
    parsed
        .get("analysis_status")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Estado de sync por meeting.
///
/// Una sola query agregada para TODOS los meetings del usuario (nada de N
/// consultas por fila). El `last_error` se toma del job `failed` más reciente
/// vía subconsulta correlacionada; solo se expone cuando el estado resultante
/// es `failed` (un error viejo de un job que ya reintentó y completó no debe
/// pintar la fila de rojo). El `analysis_status` sale del `result_data` del
/// job `finalize_conversation` **completado** más reciente — con esa misma
/// pasada, sin queries extra por fila.
pub async fn sync_states(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<HashMap<String, SyncSummary>, SqlxError> {
    // Los tres `?` se enlazan por orden de aparición: subconsulta del error,
    // subconsulta del finalize, y por último el WHERE externo.
    let sql = format!(
        "SELECT sq.meeting_id,
                {rank} AS state_rank,
                (SELECT f.last_error FROM sync_queue f
                  WHERE f.meeting_id = sq.meeting_id
                    AND f.user_id = ?
                    AND f.status = 'failed'
                  ORDER BY f.updated_at DESC, f.id DESC
                  LIMIT 1) AS last_error,
                (SELECT r.result_data FROM sync_queue r
                  WHERE r.meeting_id = sq.meeting_id
                    AND r.user_id = ?
                    AND r.job_type = 'finalize_conversation'
                    AND r.status = 'completed'
                  ORDER BY r.updated_at DESC, r.id DESC
                  LIMIT 1) AS finalize_result
         FROM sync_queue sq
         WHERE sq.user_id = ?
         GROUP BY sq.meeting_id",
        rank = SYNC_RANK_SQL
    );

    let rows: Vec<(String, i64, Option<String>, Option<String>)> = sqlx::query_as(&sql)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(meeting_id, rank, last_error, finalize_result)| {
            let state = rank_to_state(rank);
            let error = if state == "failed" { last_error } else { None };
            (
                meeting_id,
                SyncSummary {
                    state: state.to_string(),
                    error,
                    analysis_status: analysis_status_from_result(finalize_result),
                },
            )
        })
        .collect())
}

/// Lista de meetings del usuario con palabras, duración y estado de sync reales.
#[tauri::command]
pub async fn api_get_meetings_overview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MeetingOverview>, String> {
    // Privacidad: sin sesión no hay lista (mismo criterio que `api_get_meetings`).
    let user_id = match state.current_user_id().await {
        Some(id) => id,
        None => {
            log_info!("api_get_meetings_overview: no current user, returning empty list");
            return Ok(Vec::new());
        }
    };

    let pool = state.db_manager.pool();

    let meetings = MeetingsRepository::get_meetings(pool, &user_id)
        .await
        .map_err(|e| {
            log_error!("api_get_meetings_overview: error getting meetings: {}", e);
            e.to_string()
        })?;

    let aggregates = transcript_aggregates(pool, &user_id).await.map_err(|e| {
        log_error!("api_get_meetings_overview: error aggregating transcripts: {}", e);
        e.to_string()
    })?;

    let states = sync_states(pool, &user_id).await.map_err(|e| {
        log_error!("api_get_meetings_overview: error reading sync states: {}", e);
        e.to_string()
    })?;

    let overview: Vec<MeetingOverview> = meetings
        .into_iter()
        .map(|m| {
            let (words_count, duration_seconds) =
                aggregates.get(&m.id).copied().unwrap_or((0, 0));
            let summary = states.get(&m.id).cloned().unwrap_or(SyncSummary {
                state: "none".to_string(),
                error: None,
                analysis_status: None,
            });

            MeetingOverview {
                id: m.id,
                title: m.title,
                created_at: m.created_at.0.to_rfc3339(),
                updated_at: m.updated_at.0.to_rfc3339(),
                folder_path: m.folder_path,
                cloud_idempotency_key: m.cloud_idempotency_key,
                words_count,
                duration_seconds,
                sync_state: summary.state,
                sync_error: summary.error,
                analysis_status: summary.analysis_status,
            }
        })
        .collect();

    log_info!(
        "api_get_meetings_overview: {} meetings for user {}",
        overview.len(),
        user_id
    );

    Ok(overview)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    const TEST_USER: &str = "test-user-id";

    /// Subconjunto del esquema real necesario para los agregados. `transcripts`
    /// y `meetings` vienen de `20250916100000_initial_schema` + las ALTER de
    /// `20251006000000_add_audio_sync_fields` / privacidad.
    const SCHEMA: &str = r#"
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            user_id TEXT
        );
        CREATE TABLE transcripts (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            transcript TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            audio_start_time REAL,
            audio_end_time REAL
        );
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
            lease_expires_at TEXT
        );
    "#;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        for stmt in SCHEMA.split(';').filter(|s| !s.trim().is_empty()) {
            sqlx::query(stmt).execute(&pool).await.expect("schema");
        }
        pool
    }

    async fn insert_meeting(pool: &SqlitePool, id: &str, user_id: Option<&str>) {
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, user_id)
             VALUES (?, ?, datetime('now'), datetime('now'), ?)",
        )
        .bind(id)
        .bind(format!("meeting {}", id))
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_transcript(
        pool: &SqlitePool,
        id: &str,
        meeting_id: &str,
        text: &str,
        audio_end_time: Option<f64>,
    ) {
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_end_time)
             VALUES (?, ?, ?, datetime('now'), ?)",
        )
        .bind(id)
        .bind(meeting_id)
        .bind(text)
        .bind(audio_end_time)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_job(
        pool: &SqlitePool,
        meeting_id: &str,
        job_type: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> i64 {
        let res = sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, status, last_error, user_id)
             VALUES (?, ?, '{}', ?, ?, ?)",
        )
        .bind(job_type)
        .bind(meeting_id)
        .bind(status)
        .bind(last_error)
        .bind(TEST_USER)
        .execute(pool)
        .await
        .unwrap();
        res.last_insert_rowid()
    }

    async fn insert_finalize_result(
        pool: &SqlitePool,
        meeting_id: &str,
        status: &str,
        result_data: Option<&str>,
    ) -> i64 {
        let res = sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, status, result_data, user_id)
             VALUES ('finalize_conversation', ?, '{}', ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(status)
        .bind(result_data)
        .bind(TEST_USER)
        .execute(pool)
        .await
        .unwrap();
        res.last_insert_rowid()
    }

    #[tokio::test]
    async fn word_count_uses_split_whitespace_semantics() {
        let pool = setup_pool().await;
        insert_meeting(&pool, "m1", Some(TEST_USER)).await;
        // Espacios repetidos, tab, y padding a los lados: `split_whitespace`
        // cuenta 3, `split(/\s+/)` del frontend contaría de más.
        insert_transcript(&pool, "t1", "m1", "  hola   mundo\tcruel  ", Some(2.0)).await;
        insert_transcript(&pool, "t2", "m1", "otra linea aqui", Some(5.4)).await;
        // Segmento vacío: aporta 0, no 1.
        insert_transcript(&pool, "t3", "m1", "   ", Some(1.0)).await;

        let agg = transcript_aggregates(&pool, TEST_USER).await.unwrap();
        assert_eq!(agg.get("m1").unwrap().0, 6);
    }

    #[tokio::test]
    async fn duration_is_max_audio_end_time_rounded() {
        let pool = setup_pool().await;
        insert_meeting(&pool, "m1", Some(TEST_USER)).await;
        insert_transcript(&pool, "t1", "m1", "uno", Some(120.4)).await;
        // Fuera de orden a propósito: el max no depende del orden de inserción.
        insert_transcript(&pool, "t2", "m1", "dos", Some(310.6)).await;
        insert_transcript(&pool, "t3", "m1", "tres", Some(200.0)).await;
        // Sin timestamp (segmento viejo) — no debe romper ni ganar.
        insert_transcript(&pool, "t4", "m1", "cuatro", None).await;

        let agg = transcript_aggregates(&pool, TEST_USER).await.unwrap();
        assert_eq!(agg.get("m1").unwrap().1, 311);
    }

    #[tokio::test]
    async fn aggregates_are_scoped_per_meeting_and_user() {
        let pool = setup_pool().await;
        insert_meeting(&pool, "m1", Some(TEST_USER)).await;
        insert_meeting(&pool, "m2", Some(TEST_USER)).await;
        insert_meeting(&pool, "otro", Some("other-user")).await;

        insert_transcript(&pool, "t1", "m1", "una dos", Some(10.0)).await;
        insert_transcript(&pool, "t2", "m2", "tres", Some(90.0)).await;
        insert_transcript(&pool, "t3", "otro", "no deberia aparecer nunca", Some(999.0)).await;

        let agg = transcript_aggregates(&pool, TEST_USER).await.unwrap();
        assert_eq!(agg.get("m1"), Some(&(2, 10)));
        assert_eq!(agg.get("m2"), Some(&(1, 90)));
        assert!(agg.get("otro").is_none(), "meetings de otro usuario no se agregan");
    }

    #[tokio::test]
    async fn sync_state_prioritizes_failed_over_everything() {
        let pool = setup_pool().await;
        insert_job(&pool, "m1", "save_conversation", "completed", None).await;
        insert_job(&pool, "m1", "save_transcript_segments", "in_progress", None).await;
        insert_job(&pool, "m1", "finalize_conversation", "failed", Some("quota: sin creditos")).await;

        let states = sync_states(&pool, TEST_USER).await.unwrap();
        let summary = states.get("m1").unwrap();
        assert_eq!(summary.state, "failed");
        assert_eq!(summary.error.as_deref(), Some("quota: sin creditos"));
    }

    #[tokio::test]
    async fn sync_state_priority_ladder_without_failed() {
        let pool = setup_pool().await;
        // in_progress gana a pending y completed
        insert_job(&pool, "m1", "a", "completed", None).await;
        insert_job(&pool, "m1", "b", "pending", None).await;
        insert_job(&pool, "m1", "c", "in_progress", None).await;
        // pending gana a completed
        insert_job(&pool, "m2", "a", "completed", None).await;
        insert_job(&pool, "m2", "b", "pending", None).await;
        // todo completed
        insert_job(&pool, "m3", "a", "completed", None).await;
        insert_job(&pool, "m3", "b", "completed", None).await;

        let states = sync_states(&pool, TEST_USER).await.unwrap();
        assert_eq!(states.get("m1").unwrap().state, "in_progress");
        assert_eq!(states.get("m2").unwrap().state, "pending");
        assert_eq!(states.get("m3").unwrap().state, "completed");
        // Un meeting sin jobs simplemente no aparece → el comando lo resuelve a "none".
        assert!(states.get("m4").is_none());
    }

    #[tokio::test]
    async fn sync_error_is_hidden_when_state_is_not_failed() {
        let pool = setup_pool().await;
        // Un job que falló y luego revivió (pending): la fila NO debe pintarse
        // de rojo por un last_error viejo… pero ese error vive en OTRO job.
        insert_job(&pool, "m1", "a", "failed", Some("network: timeout")).await;
        insert_job(&pool, "m1", "b", "pending", None).await;
        let states = sync_states(&pool, TEST_USER).await.unwrap();
        assert_eq!(
            states.get("m1").unwrap().state,
            "failed",
            "un failed manda sobre pending"
        );

        // Sin ningún failed, no hay error que mostrar.
        let pool2 = setup_pool().await;
        insert_job(&pool2, "m2", "a", "pending", Some("network: timeout")).await;
        let states2 = sync_states(&pool2, TEST_USER).await.unwrap();
        assert_eq!(states2.get("m2").unwrap().state, "pending");
        assert_eq!(states2.get("m2").unwrap().error, None);
    }

    #[tokio::test]
    async fn analysis_status_sale_del_result_data_del_finalize_completado() {
        let pool = setup_pool().await;
        // Caso cuota: la nube respondió 200 con quota_skipped → el job está
        // COMPLETED (el sync no falló) y la única señal vive en result_data.
        insert_job(&pool, "m1", "save_conversation", "completed", None).await;
        insert_finalize_result(
            &pool,
            "m1",
            "completed",
            Some(r#"{"ok":true,"conversation_id":"c1","analysis_status":"quota_skipped","quota":{"feature":"omi_conversation","used":3,"limit":3,"period":"daily"}}"#),
        )
        .await;

        let states = sync_states(&pool, TEST_USER).await.unwrap();
        let summary = states.get("m1").unwrap();
        assert_eq!(summary.state, "completed");
        assert_eq!(summary.analysis_status.as_deref(), Some("quota_skipped"));
    }

    #[tokio::test]
    async fn analysis_status_ausente_cuando_no_hay_finalize_utilizable() {
        let pool = setup_pool().await;
        // (a) finalize aún corriendo → sin result_data que leer.
        insert_finalize_result(&pool, "m1", "in_progress", None).await;
        // (b) finalize completado de una versión vieja: result_data sin el campo.
        insert_finalize_result(&pool, "m2", "completed", Some(r#"{"ok":true,"conversation_id":"c2"}"#)).await;
        // (c) result_data corrupto → se ignora, no revienta la lista.
        insert_finalize_result(&pool, "m3", "completed", Some("no-json")).await;
        // (d) el campo lo trae OTRO tipo de job → no cuenta.
        sqlx::query(
            "INSERT INTO sync_queue (job_type, meeting_id, payload, status, result_data, user_id)
             VALUES ('save_conversation', 'm4', '{}', 'completed', '{\"analysis_status\":\"completed\"}', ?)",
        )
        .bind(TEST_USER)
        .execute(&pool)
        .await
        .unwrap();

        let states = sync_states(&pool, TEST_USER).await.unwrap();
        for id in ["m1", "m2", "m3", "m4"] {
            assert_eq!(
                states.get(id).unwrap().analysis_status,
                None,
                "meeting {} no debería exponer analysis_status",
                id
            );
        }
    }

    #[tokio::test]
    async fn sync_states_are_scoped_by_user() {
        let pool = setup_pool().await;
        insert_job(&pool, "m1", "a", "failed", Some("auth: sin sesion")).await;
        sqlx::query("INSERT INTO sync_queue (job_type, meeting_id, payload, status, user_id) VALUES ('a','ajeno','{}','failed','other-user')")
            .execute(&pool)
            .await
            .unwrap();

        let states = sync_states(&pool, TEST_USER).await.unwrap();
        assert!(states.contains_key("m1"));
        assert!(!states.contains_key("ajeno"), "jobs de otro usuario no se exponen");
    }
}
