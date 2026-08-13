// cloud_sync/worker.rs
//
// Loop CONSUMIDOR de `sync_queue`, headless.
//
// Por qué existe: hasta jul-2026 el único ejecutor de la cola era
// `cloudSyncWorker.ts`, un `setInterval(5s)` dentro del webview. En jornada la
// ventana vive oculta en el tray y WebView2 suspende el JS off-screen, así que
// los jobs se acumulaban durante HORAS y se drenaban recién al abrir la ventana
// (badge "Sincronizando…" eterno). Este loop corre en el runtime de tokio del
// proceso Rust: no depende de que haya ventana ni de que el JS esté despierto.
//
// Contratos que este módulo NO puede romper:
//  - `claim_job` es el mutex (`AND status='pending'`). Si devuelve false, otro
//    lo tomó: se salta, no se ejecuta "por si acaso".
//  - `next_retry_at` SIEMPRE en formato SQLite `%Y-%m-%d %H:%M:%S` UTC. NUNCA
//    rfc3339: `get_ready_jobs` compara strings contra `datetime('now')` y una
//    'T' ordena después de cualquier hora del mismo día → el retry dormiría
//    hasta el día siguiente (gotcha heredado de `cloudSyncWorker.ts:450-453`).
//  - La cadena de dependencias transporta el `conversation_id` por `result_data`:
//    `save_conversation` lo produce, `save_transcript_segments` lo REENVÍA y
//    `finalize_conversation` lo lee de su dependencia. Si el reenvío se rompe,
//    el finalize no sabe a qué conversación apuntar.
//  - Sin sesión o sin usuario NO se toca la cola: diferir es correcto, quemar
//    intentos mientras el usuario está deslogueado mata los jobs en ~15 min.
//
// Nunca hace panic: cualquier error de DB se loguea y el loop sigue vivo.

use std::time::Duration;

use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use log::{debug, error, info, warn};
use serde_json::{json, Map, Value};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::api::finalize::finalize_impl;
use crate::database::models::SyncQueueJob;
use crate::database::repositories::sync_queue::SyncQueueRepository;
use crate::events;
use crate::state::AppState;

use super::executors::{execute_save_conversation, execute_save_transcript_segments};
use super::session::{get_valid_token, CloudSyncState};

// ============================================================================
// PARÁMETROS
// ============================================================================

/// Cadencia base del loop. El `Notify` lo despierta antes cuando algo se encola.
const TICK: Duration = Duration::from_secs(5);
/// Lease del claim. Un job abandonado revive a los 5 min vía `reset_stale_jobs`.
const LEASE_SECS: i64 = 300;
/// Cada cuántos ticks se barren los jobs con lease vencido (12 × 5 s ≈ 1 min).
const STALE_SWEEP_EVERY_TICKS: u64 = 12;
/// Cuántos jobs se miran por pasada.
const BATCH_LIMIT: i64 = 20;
/// Periodicidad del heartbeat para el job largo (finalize).
const HEARTBEAT_EVERY: Duration = Duration::from_secs(30);
/// Tope del backoff exponencial. Se subió de 5 a 15 min a propósito: el
/// consumidor ya no depende de que el usuario abra la ventana, así que esperar
/// más entre reintentos no retrasa nada y baja el ruido contra la nube caída.
const BACKOFF_CAP_MS: u64 = 15 * 60 * 1000;
/// Cuánto se difiere un job cuando no hay sesión utilizable.
const AUTH_DEFER_SECS: i64 = 5 * 60;
/// Espera conservadora cuando la cuota no dice de qué período es.
const QUOTA_FALLBACK_HOURS: i64 = 6;

/// Formato que compara `get_ready_jobs` contra `datetime('now')`.
const SQLITE_DATETIME_FMT: &str = "%Y-%m-%d %H:%M:%S";

const JOB_SAVE_CONVERSATION: &str = "save_conversation";
const JOB_SAVE_SEGMENTS: &str = "save_transcript_segments";
const JOB_FINALIZE: &str = "finalize_conversation";

// ============================================================================
// LÓGICA PURA (testeable sin DB ni red)
// ============================================================================

/// Qué hacer con un job que falló, según el prefijo del error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    /// `quota:` — el plan se agotó. NO es un fallo: se difiere al siguiente
    /// período sin quemar intentos.
    QuotaDefer,
    /// `auth:` — sin sesión / sesión expirada. Se difiere unos minutos; quemar
    /// intentos aquí mataría la cadena mientras el usuario está deslogueado.
    AuthDefer,
    /// `not_found:` / `validation:` — reintentar no lo arregla. Failed inmediato
    /// (con cascada a la descendencia).
    Permanent,
    /// `network:` / `server:` / `unknown:` — backoff exponencial.
    Transient,
}

/// Clasificación por prefijo. Los prefijos los producen `executors.rs`,
/// `session.rs` y `api/finalize.rs`.
pub fn classify_error(error: &str) -> Disposition {
    if error.starts_with("quota:") {
        Disposition::QuotaDefer
    } else if error.starts_with("auth:") {
        Disposition::AuthDefer
    } else if error.starts_with("not_found:") || error.starts_with("validation:") {
        Disposition::Permanent
    } else {
        Disposition::Transient
    }
}

/// `period` del payload de un error `quota:` (port del `parseQuotaError` de
/// `lib/quotaErrors.ts`). Tolera JSON inválido tras el prefijo.
pub fn quota_period(error: &str) -> Option<String> {
    let payload = error.strip_prefix("quota:")?;
    let parsed: Value = serde_json::from_str(payload).ok()?;
    parsed
        .get("period")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn midnight_utc(date: NaiveDate) -> Option<DateTime<Utc>> {
    date.and_hms_opt(0, 0, 0).map(|dt| Utc.from_utc_datetime(&dt))
}

/// Próximo despertar de un job diferido por cuota. Port 1:1 de
/// `nextQuotaRetrySqlite` (`lib/quotaErrors.ts`):
///  - `daily`   → siguiente medianoche UTC,
///  - `monthly` → día 1 del mes siguiente 00:00 UTC,
///  - otro      → ahora + 6 h (reintento conservador).
pub fn next_quota_retry(period: Option<&str>, now: DateTime<Utc>) -> DateTime<Utc> {
    let fallback = now + chrono::Duration::hours(QUOTA_FALLBACK_HOURS);
    match period {
        Some("daily") => now
            .date_naive()
            .succ_opt()
            .and_then(midnight_utc)
            .unwrap_or(fallback),
        Some("monthly") => {
            let (year, month) = if now.month() == 12 {
                (now.year() + 1, 1)
            } else {
                (now.year(), now.month() + 1)
            };
            NaiveDate::from_ymd_opt(year, month, 1)
                .and_then(midnight_utc)
                .unwrap_or(fallback)
        }
        _ => fallback,
    }
}

/// `'YYYY-MM-DD HH:MM:SS'` UTC. El ÚNICO formato que puede entrar a
/// `next_retry_at` (ver cabecera del módulo).
pub fn to_sqlite_utc(dt: DateTime<Utc>) -> String {
    dt.format(SQLITE_DATETIME_FMT).to_string()
}

/// Backoff exponencial con jitter, espejo de `calculateNextRetry` del worker JS:
/// `2^(n-1)` segundos, cap primero y jitter 0-30 % después (el máximo real es
/// `cap * 1.3`). `jitter_ratio` ∈ [0,1] se inyecta para poder testear.
pub fn backoff_delay_ms(attempt_number: i64, jitter_ratio: f64) -> u64 {
    let exponent = attempt_number.max(1).saturating_sub(1).min(30) as u32;
    let base = 1000u64
        .saturating_mul(2u64.saturating_pow(exponent))
        .min(BACKOFF_CAP_MS);
    let jitter = base as f64 * 0.3 * jitter_ratio.clamp(0.0, 1.0);
    base + jitter as u64
}

// ============================================================================
// ARRANQUE
// ============================================================================

/// Arranca el loop consumidor. Se llama una sola vez desde el `setup()` de
/// `lib.rs`, justo después del `reset_stale_jobs` de arranque.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    // La sesión se `manage`a en el builder (antes del setup), así que a esta
    // altura siempre existe; aun así se resuelve defensivamente.
    let notify = match app.try_state::<CloudSyncState>() {
        Some(state) => state.notify.clone(),
        None => {
            error!("cloud_sync: CloudSyncState no está manejado; el loop no arranca");
            return;
        }
    };

    let mut ticker = tokio::time::interval(TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ticks: u64 = 0;

    info!("cloud_sync: loop consumidor headless arrancado (tick {:?})", TICK);

    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = notify.notified() => {}
        }

        ticks = ticks.wrapping_add(1);
        tick(&app, ticks).await;
    }
}

/// Una pasada del loop. Nunca propaga error: los problemas de DB se loguean y
/// el loop sobrevive.
async fn tick<R: Runtime>(app: &AppHandle<R>, ticks: u64) {
    // Guard 1: usuario local. Sin él no se sabe de quién son los jobs.
    let (pool, user_id) = {
        let Some(app_state) = app.try_state::<AppState>() else {
            return;
        };
        let Some(user_id) = app_state.current_user_id().await else {
            return;
        };
        // `SqlitePool` es un Arc: clonarlo suelta el borrow del State.
        (app_state.db_manager.pool().clone(), user_id)
    };

    // Guard 2: sesión Supabase sembrada. Sin ella todo job fallaría con
    // `auth:no_session` y se iría difiriendo; mejor ni tocarlos.
    let has_session = match app.try_state::<CloudSyncState>() {
        Some(state) => state.snapshot().await.is_some(),
        None => false,
    };
    if !has_session {
        return;
    }

    // Barrido de leases vencidos (~1 min). Rescata jobs que quedaron
    // 'in_progress' por un cierre abrupto sin esperar al próximo arranque.
    if ticks % STALE_SWEEP_EVERY_TICKS == 0 {
        match SyncQueueRepository::reset_stale_jobs(&pool, LEASE_SECS).await {
            Ok(n) if n > 0 => info!("cloud_sync: {} job(s) con lease vencido devueltos a pending", n),
            Ok(_) => {}
            Err(e) => warn!("cloud_sync: reset_stale_jobs falló: {}", e),
        }
    }

    let jobs = match SyncQueueRepository::get_ready_jobs(&pool, BATCH_LIMIT, &user_id).await {
        Ok(jobs) => jobs,
        Err(e) => {
            warn!("cloud_sync: no se pudieron leer los jobs listos: {}", e);
            return;
        }
    };

    if jobs.is_empty() {
        return;
    }

    debug!("cloud_sync: {} job(s) listos", jobs.len());
    for job in &jobs {
        process_job(app, &pool, job).await;
    }
}

// ============================================================================
// PROCESAMIENTO DE UN JOB
// ============================================================================

async fn process_job<R: Runtime>(app: &AppHandle<R>, pool: &SqlitePool, job: &SyncQueueJob) {
    match SyncQueueRepository::claim_job(pool, job.id, LEASE_SECS).await {
        Ok(true) => {}
        Ok(false) => {
            // Otro ejecutor (o el propio JS legacy de una versión vieja) lo tomó.
            debug!("cloud_sync: job {} ya estaba tomado; se salta", job.id);
            return;
        }
        Err(e) => {
            warn!("cloud_sync: no se pudo tomar el job {}: {}", job.id, e);
            return;
        }
    }

    // El finalize puede tardar minutos (LLM + embeddings del lado de la nube):
    // sin heartbeat el lease de 5 min vencería y `reset_stale_jobs` lo devolvería
    // a 'pending' mientras todavía está corriendo → doble ejecución.
    let heartbeat = if job.job_type == JOB_FINALIZE {
        Some(spawn_heartbeat(pool.clone(), job.id))
    } else {
        None
    };

    let outcome = execute(app, pool, job).await;

    if let Some(handle) = heartbeat {
        handle.abort();
    }

    match outcome {
        Ok(result) => complete(app, pool, job, result).await,
        Err(error) => handle_failure(app, pool, job, &error).await,
    }
}

fn spawn_heartbeat(pool: SqlitePool, job_id: i64) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT_EVERY).await;
            match SyncQueueRepository::heartbeat_job(&pool, job_id, LEASE_SECS).await {
                Ok(true) => debug!("cloud_sync: lease del job {} extendido", job_id),
                Ok(false) => {
                    // Ya no está 'in_progress': lo completó/falló otra rama o lo
                    // reseteó el barrido. Sin dueño no hay nada que extender.
                    debug!("cloud_sync: job {} ya no está in_progress; heartbeat detenido", job_id);
                    break;
                }
                Err(e) => warn!("cloud_sync: heartbeat del job {} falló: {}", job_id, e),
            }
        }
    })
}

/// Ejecuta el job y devuelve el `result_data` que se guardará.
async fn execute<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    job: &SyncQueueJob,
) -> Result<Value, String> {
    match job.job_type.as_str() {
        JOB_SAVE_CONVERSATION => {
            let conversation_id = execute_save_conversation(app, &job.payload).await?;
            Ok(json!({ "conversation_id": conversation_id }))
        }

        JOB_SAVE_SEGMENTS => {
            let conversation_id = dependency_conversation_id(pool, job.id).await?;
            execute_save_transcript_segments(app, &conversation_id, &job.payload).await?;
            // REENVÍO obligatorio: el finalize lee su conversation_id del
            // result_data de ESTE job, no del abuelo.
            Ok(json!({ "conversation_id": conversation_id }))
        }

        JOB_FINALIZE => {
            let conversation_id = dependency_conversation_id(pool, job.id).await?;

            let payload: Value = serde_json::from_str(&job.payload)
                .map_err(|e| format!("validation:Payload de finalize ilegible ({})", e))?;
            let duration_seconds = payload
                .get("duration_seconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            // Espejo del default del worker JS: cualquier valor que no sea
            // 'presentation' cae a 'conversation' (payloads viejos sin el campo).
            let recording_mode = Some(
                if payload.get("recording_mode").and_then(Value::as_str) == Some("presentation") {
                    "presentation".to_string()
                } else {
                    "conversation".to_string()
                },
            );

            let token = get_valid_token(app).await?;

            let response = finalize_impl(
                conversation_id.clone(),
                duration_seconds,
                token,
                recording_mode,
            )
            .await?;

            if !response.ok {
                return Err(format!(
                    "server:finalize devolvió ok=false ({})",
                    response.error.as_deref().unwrap_or("sin detalle")
                ));
            }

            // El result_data conserva TODO lo que devolvió la nube y fuerza el
            // `conversation_id` local (la respuesta puede omitirlo). Lo leen
            // `sync_queue_get_finalize_result` y el swap local→cloud de
            // `/conversations`.
            let mut result = serde_json::to_value(&response)
                .map_err(|e| format!("server:Respuesta de finalize no serializable ({})", e))?;
            if let Some(obj) = result.as_object_mut() {
                obj.insert("conversation_id".to_string(), json!(conversation_id));
            }
            Ok(result)
        }

        other => Err(format!("validation:Tipo de job desconocido: {}", other)),
    }
}

/// `conversation_id` del `result_data` de la dependencia. `get_ready_jobs` ya
/// garantiza que la dependencia está 'completed', así que si falta el dato es
/// corrupción real: error `validation:` → permanente, no reintento infinito.
async fn dependency_conversation_id(pool: &SqlitePool, job_id: i64) -> Result<String, String> {
    let raw = SyncQueueRepository::get_dependency_result(pool, job_id)
        .await
        .map_err(|e| format!("server:No se pudo leer el result_data de la dependencia ({})", e))?
        .ok_or_else(|| {
            "validation:La dependencia no dejó result_data con conversation_id".to_string()
        })?;

    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("validation:result_data de la dependencia ilegible ({})", e))?;

    parsed
        .get("conversation_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "validation:La dependencia no trae conversation_id".to_string())
}

async fn complete<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    job: &SyncQueueJob,
    result: Value,
) {
    let serialized = result.to_string();
    match SyncQueueRepository::complete_job(pool, job.id, Some(&serialized)).await {
        Ok(_) => info!(
            "cloud_sync: job {} ({}) completado para {}",
            job.id, job.job_type, job.meeting_id
        ),
        Err(e) => {
            error!("cloud_sync: no se pudo marcar completado el job {}: {}", job.id, e);
            // Sin evento: el estado en DB no cambió y el lease lo rescatará.
            return;
        }
    }

    emit_status(app, &job.meeting_id, &job.job_type, "completed", None);
}

async fn handle_failure<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    job: &SyncQueueJob,
    error: &str,
) {
    let disposition = classify_error(error);

    let status = match disposition {
        Disposition::QuotaDefer => {
            let period = quota_period(error);
            let retry_at = to_sqlite_utc(next_quota_retry(period.as_deref(), Utc::now()));
            info!(
                "cloud_sync: job {} ({}) diferido por cuota [{}] hasta {}",
                job.id,
                job.job_type,
                period.as_deref().unwrap_or("desconocido"),
                retry_at
            );
            if let Err(e) = SyncQueueRepository::defer_job(pool, job.id, &retry_at, error).await {
                error!("cloud_sync: no se pudo diferir por cuota el job {}: {}", job.id, e);
                return;
            }
            "retrying"
        }

        Disposition::AuthDefer => {
            let retry_at =
                to_sqlite_utc(Utc::now() + chrono::Duration::seconds(AUTH_DEFER_SECS));
            warn!(
                "cloud_sync: job {} ({}) diferido por sesión hasta {} ({})",
                job.id, job.job_type, retry_at, error
            );
            if let Err(e) = SyncQueueRepository::defer_job(pool, job.id, &retry_at, error).await {
                error!("cloud_sync: no se pudo diferir por auth el job {}: {}", job.id, e);
                return;
            }
            "retrying"
        }

        Disposition::Permanent => {
            error!(
                "cloud_sync: job {} ({}) falló de forma permanente: {}",
                job.id, job.job_type, error
            );
            if let Err(e) = SyncQueueRepository::fail_job_permanent(pool, job.id, error).await {
                error!("cloud_sync: no se pudo fallar el job {}: {}", job.id, e);
                return;
            }
            "failed"
        }

        Disposition::Transient => {
            let next_attempt = job.attempt_count + 1;
            let exhausted = next_attempt >= job.max_attempts;
            let next_retry_at = if exhausted {
                None
            } else {
                let delay = backoff_delay_ms(next_attempt, rand::random::<f64>());
                Some(to_sqlite_utc(
                    Utc::now() + chrono::Duration::milliseconds(delay as i64),
                ))
            };
            warn!(
                "cloud_sync: job {} ({}) falló (intento {}/{}, retry={:?}): {}",
                job.id, job.job_type, next_attempt, job.max_attempts, next_retry_at, error
            );
            if let Err(e) =
                SyncQueueRepository::fail_job(pool, job.id, error, next_retry_at.as_deref()).await
            {
                error!("cloud_sync: no se pudo registrar el fallo del job {}: {}", job.id, e);
                return;
            }
            if exhausted {
                "failed"
            } else {
                "retrying"
            }
        }
    };

    emit_status(app, &job.meeting_id, &job.job_type, status, Some(error));
}

/// Puente al bus DOM del frontend: `cloudSyncWorker.ts` reenvía este evento
/// como `CustomEvent('sync-status-changed')`. Las keys del payload son las
/// MISMAS que emitía el ejecutor JS (`meetingId`/`jobType`/`status`), porque
/// `useCloudSyncStatuses`, `/conversations` y `PlanIndicator` filtran por ellas.
/// `error` es aditivo (antes no existía).
fn emit_status<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    job_type: &str,
    status: &str,
    error: Option<&str>,
) {
    let mut payload = Map::new();
    payload.insert("meetingId".to_string(), json!(meeting_id));
    payload.insert("jobType".to_string(), json!(job_type));
    payload.insert("status".to_string(), json!(status));
    if let Some(err) = error {
        payload.insert("error".to_string(), json!(err));
    }

    if let Err(e) = app.emit(events::CLOUD_SYNC_STATUS_CHANGED, Value::Object(payload)) {
        warn!("cloud_sync: no se pudo emitir cloud-sync-status-changed: {}", e);
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;
    use sqlx::sqlite::SqlitePoolOptions;

    // ---------- clasificación ----------

    #[test]
    fn clasifica_por_prefijo() {
        assert_eq!(classify_error("quota:{\"period\":\"daily\"}"), Disposition::QuotaDefer);
        assert_eq!(classify_error("auth:no_session"), Disposition::AuthDefer);
        assert_eq!(classify_error("auth:session_expired"), Disposition::AuthDefer);
        assert_eq!(classify_error("not_found:conv"), Disposition::Permanent);
        assert_eq!(classify_error("validation:payload"), Disposition::Permanent);
        assert_eq!(classify_error("network:sin red"), Disposition::Transient);
        assert_eq!(classify_error("server:HTTP 502"), Disposition::Transient);
        assert_eq!(classify_error("unknown:HTTP 429"), Disposition::Transient);
        // Sin prefijo conocido → transitorio (nunca permanente por defecto: un
        // error nuevo no debe matar la cadena de sync del usuario).
        assert_eq!(classify_error("boom"), Disposition::Transient);
    }

    // ---------- cuota (port de nextQuotaRetrySqlite) ----------

    #[test]
    fn quota_period_lee_el_payload_del_error() {
        assert_eq!(
            quota_period(r#"quota:{"message":"x","period":"monthly"}"#).as_deref(),
            Some("monthly")
        );
        // JSON inválido tras el prefijo → sin período (cae al fallback de 6 h).
        assert!(quota_period("quota:no-json").is_none());
        // Sin período explícito.
        assert!(quota_period(r#"quota:{"message":"x"}"#).is_none());
        // No es un error de cuota.
        assert!(quota_period("network:x").is_none());
    }

    fn at(y: i32, m: u32, d: u32, h: u32, mi: u32, s: u32) -> DateTime<Utc> {
        Utc.from_utc_datetime(
            &NaiveDate::from_ymd_opt(y, m, d)
                .unwrap()
                .and_hms_opt(h, mi, s)
                .unwrap(),
        )
    }

    #[test]
    fn quota_daily_despierta_en_la_siguiente_medianoche_utc() {
        let now = at(2026, 8, 12, 23, 30, 0);
        assert_eq!(next_quota_retry(Some("daily"), now), at(2026, 8, 13, 0, 0, 0));
        // Cruce de mes.
        let fin_de_mes = at(2026, 8, 31, 10, 0, 0);
        assert_eq!(
            next_quota_retry(Some("daily"), fin_de_mes),
            at(2026, 9, 1, 0, 0, 0)
        );
    }

    #[test]
    fn quota_monthly_despierta_el_dia_1_del_mes_siguiente() {
        let now = at(2026, 8, 12, 5, 0, 0);
        assert_eq!(next_quota_retry(Some("monthly"), now), at(2026, 9, 1, 0, 0, 0));
        // Cruce de año.
        let diciembre = at(2026, 12, 20, 5, 0, 0);
        assert_eq!(
            next_quota_retry(Some("monthly"), diciembre),
            at(2027, 1, 1, 0, 0, 0)
        );
    }

    #[test]
    fn quota_desconocida_espera_seis_horas() {
        let now = at(2026, 8, 12, 5, 0, 0);
        assert_eq!(next_quota_retry(None, now), at(2026, 8, 12, 11, 0, 0));
        assert_eq!(
            next_quota_retry(Some("weekly"), now),
            at(2026, 8, 12, 11, 0, 0)
        );
    }

    // ---------- formato de next_retry_at ----------

    /// El bug más caro de esta cola: `get_ready_jobs` compara STRINGS contra
    /// `datetime('now')`. Un rfc3339 con 'T' ordena después de cualquier hora
    /// del mismo día → el job dormiría hasta el día siguiente.
    #[test]
    fn next_retry_at_siempre_en_formato_sqlite() {
        let re = Regex::new(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$").unwrap();
        let now = at(2026, 8, 12, 5, 4, 3);

        let candidatos = vec![
            to_sqlite_utc(now),
            to_sqlite_utc(next_quota_retry(Some("daily"), now)),
            to_sqlite_utc(next_quota_retry(Some("monthly"), now)),
            to_sqlite_utc(next_quota_retry(None, now)),
            to_sqlite_utc(now + chrono::Duration::seconds(AUTH_DEFER_SECS)),
            to_sqlite_utc(
                now + chrono::Duration::milliseconds(backoff_delay_ms(3, 0.5) as i64),
            ),
        ];

        for value in candidatos {
            assert!(re.is_match(&value), "formato inválido: {}", value);
            assert!(!value.contains('T'), "rfc3339 prohibido: {}", value);
        }

        assert_eq!(to_sqlite_utc(now), "2026-08-12 05:04:03");
    }

    // ---------- backoff ----------

    #[test]
    fn backoff_es_exponencial_y_respeta_el_cap() {
        // Sin jitter: 1s, 2s, 4s, 8s…
        assert_eq!(backoff_delay_ms(1, 0.0), 1_000);
        assert_eq!(backoff_delay_ms(2, 0.0), 2_000);
        assert_eq!(backoff_delay_ms(3, 0.0), 4_000);
        assert_eq!(backoff_delay_ms(4, 0.0), 8_000);
        // Cap de 15 min (subido a propósito desde los 5 min del worker JS).
        assert_eq!(backoff_delay_ms(20, 0.0), BACKOFF_CAP_MS);
        assert_eq!(backoff_delay_ms(64, 0.0), BACKOFF_CAP_MS);
    }

    #[test]
    fn backoff_agrega_hasta_30_por_ciento_de_jitter() {
        assert_eq!(backoff_delay_ms(3, 1.0), 4_000 + 1_200);
        assert_eq!(backoff_delay_ms(3, 0.5), 4_000 + 600);
        // Ratios fuera de rango no rompen el techo.
        assert_eq!(backoff_delay_ms(3, 5.0), 4_000 + 1_200);
        assert_eq!(backoff_delay_ms(3, -1.0), 4_000);
        // Techo absoluto del retraso.
        assert_eq!(
            backoff_delay_ms(99, 1.0),
            BACKOFF_CAP_MS + (BACKOFF_CAP_MS as f64 * 0.3) as u64
        );
    }

    // ---------- transiciones de la cola por clasificación ----------

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
            lease_expires_at TEXT,
            FOREIGN KEY (depends_on) REFERENCES sync_queue(id) ON DELETE SET NULL
        );
    "#;

    const TEST_USER: &str = "test-user-id";

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query(SCHEMA).execute(&pool).await.expect("schema");
        pool
    }

    /// Aplica la MISMA transición que `handle_failure`, sin `AppHandle` (los
    /// eventos Tauri necesitan una app viva; acá se verifica el efecto en la
    /// cola, que es lo que decide si el job revive o muere).
    async fn apply_failure(pool: &SqlitePool, job: &SyncQueueJob, error: &str) {
        match classify_error(error) {
            Disposition::QuotaDefer => {
                let retry_at =
                    to_sqlite_utc(next_quota_retry(quota_period(error).as_deref(), Utc::now()));
                SyncQueueRepository::defer_job(pool, job.id, &retry_at, error)
                    .await
                    .unwrap();
            }
            Disposition::AuthDefer => {
                let retry_at =
                    to_sqlite_utc(Utc::now() + chrono::Duration::seconds(AUTH_DEFER_SECS));
                SyncQueueRepository::defer_job(pool, job.id, &retry_at, error)
                    .await
                    .unwrap();
            }
            Disposition::Permanent => {
                SyncQueueRepository::fail_job_permanent(pool, job.id, error)
                    .await
                    .unwrap();
            }
            Disposition::Transient => {
                let next_attempt = job.attempt_count + 1;
                let next_retry_at = if next_attempt >= job.max_attempts {
                    None
                } else {
                    Some(to_sqlite_utc(
                        Utc::now()
                            + chrono::Duration::milliseconds(
                                backoff_delay_ms(next_attempt, 0.0) as i64
                            ),
                    ))
                };
                SyncQueueRepository::fail_job(pool, job.id, error, next_retry_at.as_deref())
                    .await
                    .unwrap();
            }
        }
    }

    async fn enqueue_claimed(pool: &SqlitePool, max_attempts: i64) -> SyncQueueJob {
        let id = SyncQueueRepository::enqueue(
            pool,
            JOB_FINALIZE,
            "m1",
            "{}",
            max_attempts,
            None,
            TEST_USER,
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(pool, id, LEASE_SECS).await.unwrap();
        SyncQueueRepository::get_job_by_id(pool, id).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn error_de_cuota_difiere_sin_quemar_intentos() {
        let pool = setup_pool().await;
        let job = enqueue_claimed(&pool, 10).await;

        apply_failure(&pool, &job, r#"quota:{"period":"monthly"}"#).await;

        let after = SyncQueueRepository::get_job_by_id(&pool, job.id).await.unwrap().unwrap();
        assert_eq!(after.status, "pending");
        assert_eq!(after.attempt_count, 0, "la cuota no es un fallo del job");
        let retry = after.next_retry_at.expect("next_retry_at");
        assert!(retry > "2026-01-01 00:00:00".to_string());
        assert!(!retry.contains('T'));
        // Diferido al futuro → no vuelve a la cola de listos.
        assert!(SyncQueueRepository::get_ready_jobs(&pool, 10, TEST_USER)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn error_de_auth_difiere_sin_quemar_intentos() {
        let pool = setup_pool().await;
        let job = enqueue_claimed(&pool, 10).await;

        apply_failure(&pool, &job, "auth:no_session").await;

        let after = SyncQueueRepository::get_job_by_id(&pool, job.id).await.unwrap().unwrap();
        assert_eq!(after.status, "pending");
        assert_eq!(
            after.attempt_count, 0,
            "sin sesión el job espera, no consume sus 10 vidas"
        );
        assert!(after.next_retry_at.is_some());
    }

    #[tokio::test]
    async fn error_permanente_falla_de_inmediato_y_cascadea() {
        let pool = setup_pool().await;
        let parent = SyncQueueRepository::enqueue(
            &pool,
            JOB_SAVE_CONVERSATION,
            "m1",
            "{}",
            10,
            None,
            TEST_USER,
        )
        .await
        .unwrap();
        let child = SyncQueueRepository::enqueue(
            &pool,
            JOB_SAVE_SEGMENTS,
            "m1",
            "{}",
            10,
            Some(parent),
            TEST_USER,
        )
        .await
        .unwrap();
        SyncQueueRepository::claim_job(&pool, parent, LEASE_SECS).await.unwrap();
        let job = SyncQueueRepository::get_job_by_id(&pool, parent).await.unwrap().unwrap();

        apply_failure(&pool, &job, "validation:Payload sin user_id").await;

        let after = SyncQueueRepository::get_job_by_id(&pool, parent).await.unwrap().unwrap();
        assert_eq!(after.status, "failed");
        assert_eq!(after.attempt_count, 0, "permanent no quema intentos");
        assert_eq!(after.next_retry_at, None);
        assert_eq!(
            SyncQueueRepository::get_job_by_id(&pool, child).await.unwrap().unwrap().status,
            "failed",
            "la descendencia muere con el padre"
        );
    }

    #[tokio::test]
    async fn error_transitorio_reintenta_con_backoff_y_muere_al_agotar() {
        let pool = setup_pool().await;
        let job = enqueue_claimed(&pool, 2).await;

        apply_failure(&pool, &job, "network:sin internet").await;
        let after = SyncQueueRepository::get_job_by_id(&pool, job.id).await.unwrap().unwrap();
        assert_eq!(after.status, "pending");
        assert_eq!(after.attempt_count, 1);
        let retry = after.next_retry_at.clone().expect("next_retry_at programado");
        let re = Regex::new(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$").unwrap();
        assert!(re.is_match(&retry), "formato SQLite obligatorio: {}", retry);

        // Segundo fallo: agota max_attempts=2 → terminal, sin next_retry_at.
        apply_failure(&pool, &after, "server:HTTP 500").await;
        let dead = SyncQueueRepository::get_job_by_id(&pool, job.id).await.unwrap().unwrap();
        assert_eq!(dead.status, "failed");
        assert_eq!(dead.attempt_count, 2);
        assert_eq!(dead.next_retry_at, None);
    }
}
