//! Escritura de eventos de telemetría al outbox durable (`recording_logs`).
//!
//! Cero red aquí: el evento queda en SQLite (sobrevive crash, suspensión y
//! jornada headless) y se despierta a la drenadora con un `Notify`. Es el
//! mismo outbox que llenaba el frontend vía `log_recording_event` — un solo
//! esquema, un solo drenador.

use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Notify;

use crate::database::repositories::recording_log::RecordingLogRepository;

static DRAIN_NOTIFY: OnceLock<Arc<Notify>> = OnceLock::new();

/// Señal compartida emisores → drenadora. La drenadora la espera junto con su
/// tick periódico; un evento nuevo adelanta el drain sin acortar el tick.
pub fn drain_notify() -> Arc<Notify> {
    DRAIN_NOTIFY.get_or_init(|| Arc::new(Notify::new())).clone()
}

/// Escribe un evento al outbox con el envelope `ctx` inyectado en el payload.
///
/// `session_id` es el valor de la COLUMNA (para eventos de grabación, el
/// `session-…` de esa grabación — misma serie histórica que llenaba el
/// frontend); la identidad de proceso viaja dentro de `ctx.session_id`.
/// Nunca propaga error: telemetría jamás rompe al caller.
#[allow(clippy::too_many_arguments)]
pub async fn emit_event<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    event_type: &str,
    mut payload: serde_json::Value,
    status: Option<&str>,
    error: Option<&str>,
    meeting_id: Option<&str>,
) {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("ctx".into(), super::context::ctx_value(app));
    }

    let Some(state) = app.try_state::<crate::state::AppState>() else {
        // Pre-DB (arranque muy temprano): mejor perder un evento que bloquear.
        log::warn!(
            "[telemetry] AppState no disponible; evento {} descartado",
            event_type
        );
        return;
    };

    let app_version = app.package_info().version.to_string();
    let data = payload.to_string();
    if let Err(e) = RecordingLogRepository::log_event(
        state.db_manager.pool(),
        session_id,
        event_type,
        Some(&data),
        status,
        error,
        meeting_id,
        Some(&app_version),
        None,
    )
    .await
    {
        log::warn!("[telemetry] fallo al escribir {} al outbox: {}", event_type, e);
        return;
    }

    drain_notify().notify_one();
}
