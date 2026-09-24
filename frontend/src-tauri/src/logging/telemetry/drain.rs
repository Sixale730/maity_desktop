//! Drenadora nativa del outbox `recording_logs` → `maity.platform_logs`.
//!
//! Es el ÚNICO drenador (regla single-writer): `recordingLogService.syncToCloud()`
//! del webview se eliminó en el mismo commit que esto nació — dos drenadores
//! duplican filas, y el de JS además moría con la ventana oculta (WebView2
//! suspende el JS en tray/jornada; mismo motivo por el que `cloudSyncWorker.ts`
//! migró a Rust).
//!
//! Ritmo: tick de 30 s + `Notify` de los emisores (un evento nuevo adelanta el
//! drain). Solo 2xx marca `synced_to_cloud`; un fallo de auth difiere sin
//! quemar nada (el outbox es idempotente en reintento porque la fila solo se
//! marca tras el 2xx).

use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::Instant;

use crate::cloud_sync::session::get_valid_token;
use crate::cloud_sync::worker::{classify_error, Disposition};
use crate::cloud_sync::CloudSyncState;
use crate::database::models::RecordingLog;
use crate::database::repositories::recording_log::RecordingLogRepository;

const TICK_SECS: u64 = 30;
const BATCH_LIMIT: i64 = 50;
/// Pequeño respiro al arrancar para drenar el backlog del proceso anterior
/// (incluye los panics importados) sin competir con el init de la DB.
const STARTUP_DELAY_SECS: u64 = 5;

/// Filas reclamadas por CUALQUIER camino (el tick periódico o un
/// `flush_row` puntual de una ruta de salida) — evita que ambos posteen la
/// misma fila a la vez cuando coinciden. `std::sync::Mutex` porque el mapa se
/// toca solo para insertar/remover, nunca mientras se espera red.
static INFLIGHT: Mutex<Option<HashSet<i64>>> = Mutex::new(None);

/// En salida: `drain_once` (el loop de 30 s) deja de correr — nadie debe
/// refrescar token ni postear por su cuenta mientras una ruta de salida está
/// haciendo su propio `flush_row` acotado.
static EXITING: AtomicBool = AtomicBool::new(false);

/// Marca el proceso como saliendo. Idempotente; sin reversa (no hay ruta que
/// vuelva a drenar en background tras esto).
pub fn set_exiting() {
    EXITING.store(true, Ordering::SeqCst);
}

fn is_exiting() -> bool {
    EXITING.load(Ordering::SeqCst)
}

fn inflight_lock() -> std::sync::MutexGuard<'static, Option<HashSet<i64>>> {
    INFLIGHT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Guard RAII: libera el id reclamado al salir de scope (incluida una salida
/// temprana por `return`/`?`/panic).
struct InflightGuard(i64);

impl Drop for InflightGuard {
    fn drop(&mut self) {
        let mut guard = inflight_lock();
        if let Some(set) = guard.as_mut() {
            set.remove(&self.0);
        }
    }
}

/// Intenta reclamar una fila. `None` si ya la tiene otra tarea.
fn claim(id: i64) -> Option<InflightGuard> {
    let mut guard = inflight_lock();
    let set = guard.get_or_insert_with(HashSet::new);
    if set.insert(id) {
        Some(InflightGuard(id))
    } else {
        None
    }
}

/// Resultado de `flush_row`: un intento acotado en tiempo de drenar UNA fila
/// concreta desde una ruta de salida (`app.exit`, `auth.logout`, …), sin
/// esperar el tick de 30 s ni competir por el token con un refresh en vuelo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlushOutcome {
    /// 2xx del RPC; la fila quedó marcada `synced_to_cloud`.
    Sent,
    /// Ya estaba sincronizada (por el loop, u otro `flush_row`) antes de que
    /// esta llamada llegara a reclamarla.
    AlreadySynced,
    /// No hay sesión Supabase nativa sembrada.
    NoSession,
    /// El token no tiene margen y esta ruta no refresca (`token_if_fresh`).
    TokenStale,
    /// Se acabó el presupuesto (esperando la fila o esperando el POST).
    Timeout,
    /// El RPC respondió pero no fue 2xx. `Rejected(0)` = fallo LOCAL: sin
    /// `AppState` o error de SQLite al leer la fila.
    Rejected(u16),
    /// Fallo de red (sin respuesta).
    Network,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    let notify = super::emit::drain_notify();
    tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
    loop {
        drain_once(&app).await;
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(TICK_SECS)) => {},
            _ = notify.notified() => {},
        }
    }
}

/// Una pasada: lee hasta BATCH_LIMIT filas sin sincronizar, las postea una a
/// una al RPC y marca cada una apenas responde 2xx (no al final del lote: un
/// timeout a mitad ya no deja filas de más por marcar en el siguiente tick).
/// Las filas que ya tiene reclamadas un `flush_row` en vuelo se saltan.
/// Nunca propaga error.
async fn drain_once<R: Runtime>(app: &AppHandle<R>) {
    if is_exiting() {
        return;
    }
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let pool = state.db_manager.pool();

    let rows = match RecordingLogRepository::get_unsynced_logs(pool, BATCH_LIMIT).await {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[telemetry-drain] no se pudo leer el outbox: {}", e);
            return;
        }
    };
    if rows.is_empty() {
        return;
    }

    // Sesión Supabase nativa (la siembra el frontend con cloud_sync_set_session).
    // Sin sesión: diferir en silencio, sin quemar nada — el outbox espera.
    let session = {
        let cloud = app.state::<CloudSyncState>();
        cloud.snapshot().await
    };
    let Some(session) = session else {
        return;
    };
    // Volver a mirar EXITING justo antes de pedir el token: `get_valid_token`
    // puede refrescar, y una salida que empezó mientras se leía el lote no
    // debe arrancar un refresh que el proceso cortará a medias (perdería el
    // `refresh_token` ya rotado por el servidor).
    if is_exiting() {
        return;
    }
    let token = match get_valid_token(app).await {
        Ok(t) => t,
        Err(e) => {
            match classify_error(&e) {
                Disposition::AuthDefer | Disposition::QuotaDefer => {
                    log::debug!("[telemetry-drain] auth diferido: {}", e);
                }
                _ => log::warn!("[telemetry-drain] token irrecuperable: {}", e),
            }
            return;
        }
    };

    let base_url = session.supabase_url.trim_end_matches('/');
    // El RPC vive en el schema `public` (perímetro mediado, ver CLAUDE.md) —
    // NO lleva `Content-Profile: maity`; ese header es para las TABLAS de
    // executors.rs. public es el profile default de PostgREST.
    let url = format!("{}/rest/v1/rpc/insert_platform_log", base_url);
    // Cliente compartido (#20 de la auditoría): antes se construía uno por
    // tick, con su enumeración del root store y su handshake TLS.
    let client: &reqwest::Client = &crate::api::HTTP;

    let mut synced = 0usize;
    let total = rows.len();
    for row in &rows {
        if is_exiting() {
            break;
        }
        let Some(_guard) = claim(row.id) else {
            // Un `flush_row` puntual ya la tiene: no duplicar el POST.
            continue;
        };
        // Releer tras reclamar: un `flush_row` puede haber subido esta fila
        // entre la lectura del lote (arriba) y el reclamo — sin esto se
        // duplica el POST.
        match RecordingLogRepository::get_by_id(pool, row.id).await {
            Ok(Some(r)) if r.synced_to_cloud => continue,
            Ok(_) => {}
            Err(e) => {
                log::warn!(
                    "[telemetry-drain] no se pudo releer la fila {} tras reclamarla: {}",
                    row.id,
                    e
                );
            }
        }
        match post_row(client, &url, &session.anon_key, &token, row).await {
            Ok(()) => {
                match RecordingLogRepository::mark_as_synced(pool, &[row.id]).await {
                    Ok(_) => synced += 1,
                    Err(e) => log::warn!(
                        "[telemetry-drain] fallo al marcar sincronizada la fila {}: {}",
                        row.id,
                        e
                    ),
                }
            }
            Err(status) if status == 401 || status == 403 => {
                // Token rechazado: cortar el lote entero; el siguiente tick
                // llega con token refrescado.
                log::debug!("[telemetry-drain] {} del RPC; lote diferido", status);
                break;
            }
            Err(0) => {
                // Red caída: cortar el lote, reintenta el próximo tick.
                break;
            }
            Err(status) => {
                // Fila rechazada (4xx/5xx): se queda sin marcar y reintenta en
                // el siguiente tick, igual que hacía el sync de JS.
                log::warn!(
                    "[telemetry-drain] {} rechazado con {} (id {})",
                    row.event_type,
                    status,
                    row.id
                );
            }
        }
    }

    if synced > 0 {
        log::debug!("[telemetry-drain] {}/{} filas sincronizadas", synced, total);
    }
}

/// Drena UNA fila puntual con presupuesto acotado, para las rutas de salida
/// que necesitan que su evento salga (o se den por vencidas) antes de que el
/// proceso termine, sin esperar el tick de 30 s del loop.
///
/// Nunca refresca el token (`token_if_fresh`): cancelar un refresh a mitad de
/// la salida perdería el `refresh_token` ya rotado por el servidor, dejando
/// la sesión inservible en el siguiente arranque — un riesgo mucho peor que
/// perder esta fila (la drenadora normal la reintenta cuando vuelva a correr).
pub async fn flush_row<R: Runtime>(app: &AppHandle<R>, id: i64, budget: Duration) -> FlushOutcome {
    let deadline = Instant::now() + budget;

    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return FlushOutcome::Rejected(0);
    };
    let pool = state.db_manager.pool();

    // La fila se lee SOLO ya reclamada: el loop pudo reclamarla, postearla,
    // marcarla y soltarla entre una lectura previa y este reclamo, y postear
    // esa lectura vieja duplicaría la fila (el mismo TOCTOU que `drain_once`
    // evita releyendo tras su reclamo).
    let (_guard, row) = loop {
        if let Some(guard) = claim(id) {
            match pending_row(pool, id).await {
                Ok(row) => break (guard, row),
                Err(outcome) => return outcome,
            }
        }
        // El loop de 30 s ya la tiene: esperar mientras quede presupuesto en
        // vez de postear en paralelo. La siguiente vuelta relee la fila por si
        // el loop la subió.
        if Instant::now() >= deadline {
            return FlushOutcome::Timeout;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };

    let session = {
        let cloud = app.state::<CloudSyncState>();
        cloud.snapshot().await
    };
    let Some(session) = session else {
        return FlushOutcome::NoSession;
    };
    let Some(token) = crate::cloud_sync::session::token_if_fresh(app).await else {
        return FlushOutcome::TokenStale;
    };

    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return FlushOutcome::Timeout;
    }

    let base_url = session.supabase_url.trim_end_matches('/');
    let url = format!("{}/rest/v1/rpc/insert_platform_log", base_url);
    let client: &reqwest::Client = &crate::api::HTTP;

    // El `_guard` se suelta al salir de la función, DESPUÉS del mark.
    match tokio::time::timeout(
        remaining,
        post_row(client, &url, &session.anon_key, &token, &row),
    )
    .await
    {
        Ok(Ok(())) => {
            if let Err(e) = RecordingLogRepository::mark_as_synced(pool, &[id]).await {
                log::warn!(
                    "[telemetry-drain] flush_row({}) no se pudo marcar sincronizada: {}",
                    id,
                    e
                );
            }
            FlushOutcome::Sent
        }
        Ok(Err(status)) if status == 401 || status == 403 => FlushOutcome::TokenStale,
        Ok(Err(0)) => FlushOutcome::Network,
        Ok(Err(status)) => FlushOutcome::Rejected(status),
        Err(_) => FlushOutcome::Timeout,
    }
}

/// Lectura de la fila con el reclamo ya tomado. `Ok(fila)` si sigue pendiente;
/// `Err(AlreadySynced)` si otro camino ya la subió (o ya no existe);
/// `Err(Rejected(0))` si SQLite falló — nunca se reporta como subida una fila
/// que no se pudo leer.
async fn pending_row(pool: &SqlitePool, id: i64) -> Result<RecordingLog, FlushOutcome> {
    match RecordingLogRepository::get_by_id(pool, id).await {
        Ok(Some(row)) if !row.synced_to_cloud => Ok(row),
        Ok(_) => Err(FlushOutcome::AlreadySynced),
        Err(e) => {
            log::warn!("[telemetry-drain] flush_row({}) no pudo leer la fila: {}", id, e);
            Err(FlushOutcome::Rejected(0))
        }
    }
}

/// Postea UNA fila. `Err(status_http)` para respuestas no-2xx; `Err(0)` para
/// fallo de red (sin respuesta).
async fn post_row(
    client: &reqwest::Client,
    url: &str,
    anon_key: &str,
    token: &str,
    row: &RecordingLog,
) -> Result<(), u16> {
    let event_data: serde_json::Value = match &row.event_data {
        Some(raw) => serde_json::from_str(raw)
            .unwrap_or_else(|_| serde_json::Value::String(raw.clone())),
        None => serde_json::Value::Null,
    };

    let body = serde_json::json!({
        "p_session_id": row.session_id,
        "p_platform": "desktop",
        "p_event_type": row.event_type,
        "p_event_data": event_data,
        "p_status": row.status,
        "p_error": row.error,
        "p_meeting_id": row.meeting_id,
        "p_app_version": row.app_version,
        "p_device_info": row.device_info,
    });

    let response = client
        .post(url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|_| 0u16)?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(response.status().as_u16())
    }
}

#[cfg(test)]
mod tests {
    //! IDs de fila usados aquí son negativos y exclusivos por test para no
    //! chocar con otro test de este archivo corriendo en paralelo en el mismo
    //! proceso (el `INFLIGHT` es un `static`, compartido por todo el binario
    //! de tests).
    use super::*;

    #[test]
    fn reclamar_una_fila_libre_la_marca_ocupada() {
        let guard = claim(-1001);
        assert!(guard.is_some(), "la primera reclamación debe tener éxito");
    }

    #[test]
    fn reclamar_una_fila_ya_reclamada_devuelve_none() {
        let _guard = claim(-1002);
        assert!(
            claim(-1002).is_none(),
            "un `flush_row` y el loop de 30 s no deben postear la misma fila a la vez"
        );
    }

    #[test]
    fn soltar_el_guard_libera_la_fila_para_reclamarla_de_nuevo() {
        {
            let _guard = claim(-1003);
        } // Drop aquí.
        assert!(
            claim(-1003).is_some(),
            "el Drop del guard debe liberar el id reclamado"
        );
    }

    #[test]
    fn dos_ids_distintos_no_interfieren_entre_si() {
        let _a = claim(-1004);
        let _b = claim(-1005);
        assert!(claim(-1004).is_none());
        assert!(claim(-1005).is_none());
    }

    async fn setup_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
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

    /// La carrera que el refutador de A2 encontró: `flush_row` leía la fila
    /// ANTES de reclamarla; si el loop de 30 s la reclamaba, posteaba, marcaba
    /// y soltaba en medio, `flush_row` posteaba la lectura vieja. Ahora la
    /// lectura ocurre con el reclamo tomado y ve la fila ya subida.
    #[tokio::test]
    async fn la_lectura_tras_reclamar_ve_la_fila_que_el_loop_ya_subio() {
        let pool = setup_pool().await;
        let id = RecordingLogRepository::log_event(
            &pool, "proc-a", "app.exit", Some("{}"), None, None, None, Some("0.2.62"), None,
        )
        .await
        .expect("insert");

        // Mientras nadie la ha subido, la relectura la entrega para postear.
        {
            let _flush = claim(id).expect("fila libre");
            assert!(pending_row(&pool, id).await.is_ok());
        }

        // El loop la reclama, la postea y la marca; luego suelta el reclamo.
        {
            let _loop = claim(id).expect("fila libre para el loop");
            RecordingLogRepository::mark_as_synced(&pool, &[id])
                .await
                .expect("mark ok");
        }

        // `flush_row` reclama después: la relectura ya no deja nada que postear.
        let _flush = claim(id).expect("el loop soltó la fila");
        assert_eq!(
            pending_row(&pool, id).await.unwrap_err(),
            FlushOutcome::AlreadySynced
        );
    }

    #[tokio::test]
    async fn una_fila_inexistente_no_se_postea() {
        let pool = setup_pool().await;
        assert_eq!(
            pending_row(&pool, 424_242).await.unwrap_err(),
            FlushOutcome::AlreadySynced
        );
    }

    #[test]
    fn flush_outcome_expone_el_status_http_rechazado() {
        assert_eq!(FlushOutcome::Rejected(500), FlushOutcome::Rejected(500));
        assert_ne!(FlushOutcome::Rejected(500), FlushOutcome::Rejected(400));
        assert_ne!(FlushOutcome::Sent, FlushOutcome::AlreadySynced);
    }
}
