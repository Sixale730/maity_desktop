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

use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

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
/// una al RPC y marca SOLO las que respondieron 2xx. Nunca propaga error.
async fn drain_once<R: Runtime>(app: &AppHandle<R>) {
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
    let client = reqwest::Client::new();

    let mut synced_ids: Vec<i64> = Vec::new();
    for row in &rows {
        match post_row(&client, &url, &session.anon_key, &token, row).await {
            Ok(()) => synced_ids.push(row.id),
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

    if !synced_ids.is_empty() {
        let total = synced_ids.len();
        match RecordingLogRepository::mark_as_synced(pool, &synced_ids).await {
            Ok(_) => log::debug!("[telemetry-drain] {}/{} filas sincronizadas", total, rows.len()),
            Err(e) => log::warn!("[telemetry-drain] fallo al marcar sincronizadas: {}", e),
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
