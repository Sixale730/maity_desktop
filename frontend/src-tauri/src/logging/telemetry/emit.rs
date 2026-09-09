//! Escritura de eventos de telemetría al outbox durable (`recording_logs`).
//!
//! Cero red aquí: el evento queda en SQLite (sobrevive crash, suspensión y
//! jornada headless) y se despierta a la drenadora con un `Notify`. Es el
//! mismo outbox que llenaba el frontend vía `log_recording_event` — un solo
//! esquema, un solo drenador.
//!
//! Desde sep-2026 (#23 de la auditoría) también entra por aquí la analítica de
//! producto de las ventanas AUXILIARES (`log_analytics_event`, gemelo nativo de
//! `Analytics.track`): así el coach-float no carga supabase-js ni instancia un
//! segundo cliente GoTrue. El envelope conserva `emitter: "webview"` y la
//! ventana real; la COLUMNA `session_id` pasa a ser la de proceso.

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

/// Escribe un evento emitido DESDE Rust al outbox con el envelope `ctx`
/// (`emitter: "rust"`) inyectado en el payload.
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
    payload: serde_json::Value,
    status: Option<&str>,
    error: Option<&str>,
    meeting_id: Option<&str>,
) {
    let ctx = super::context::ctx_value(app);
    write_to_outbox(app, session_id, event_type, payload, ctx, status, error, meeting_id).await;
}

/// Evento que NACIÓ en un webview (ventanas aux) y viaja por el outbox nativo.
/// `ctx.emitter = "webview"`, `ctx.window = window_label`; la columna
/// `session_id` es la de proceso (`proc-…`).
pub async fn emit_webview_event<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
    event_type: &str,
    payload: serde_json::Value,
    meeting_id: Option<&str>,
) {
    let ctx = super::context::ctx_value_from_window(app, window_label);
    write_to_outbox(
        app,
        super::context::process_session_id(),
        event_type,
        payload,
        ctx,
        None,
        None,
        meeting_id,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn write_to_outbox<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    event_type: &str,
    mut payload: serde_json::Value,
    ctx: serde_json::Value,
    status: Option<&str>,
    error: Option<&str>,
    meeting_id: Option<&str>,
) {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("ctx".into(), ctx);
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

// ── Analítica de producto desde un webview ──────────────────────────────────

/// Límites del passthrough: un nombre de evento razonable y un payload chico.
/// La analítica de producto es `{clave: string}` (ver `AuxAnalyticsProperties`).
pub const ANALYTICS_EVENT_TYPE_MAX_LEN: usize = 128;
pub const ANALYTICS_PAYLOAD_MAX_BYTES: usize = 8 * 1024;

/// Valida (pura) lo que manda `trackAux`: nombre no vacío, acotado y con
/// caracteres de identificador (`coach_float.drawer_toggled`); payload objeto
/// (`None`/`null` → `{}`) y acotado en bytes serializados. Devuelve el payload
/// normalizado listo para inyectarle `ctx`.
pub fn validate_analytics_event(
    event_type: &str,
    event_data: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if event_type.is_empty() || event_type.len() > ANALYTICS_EVENT_TYPE_MAX_LEN {
        return Err(format!(
            "event_type vacío o de más de {} caracteres",
            ANALYTICS_EVENT_TYPE_MAX_LEN
        ));
    }
    if !event_type
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
    {
        return Err(format!("event_type con caracteres no permitidos: {:?}", event_type));
    }
    let payload = match event_data {
        None | Some(serde_json::Value::Null) => serde_json::json!({}),
        Some(obj @ serde_json::Value::Object(_)) => obj,
        Some(_) => return Err("event_data debe ser un objeto JSON".into()),
    };
    let size = serde_json::to_vec(&payload).map(|v| v.len()).unwrap_or(usize::MAX);
    if size > ANALYTICS_PAYLOAD_MAX_BYTES {
        return Err(format!(
            "event_data de {} bytes > {}",
            size, ANALYTICS_PAYLOAD_MAX_BYTES
        ));
    }
    Ok(payload)
}

/// Gemelo nativo de `Analytics.track` para las ventanas auxiliares
/// (`lib/auxAnalytics.ts::trackAux`). Sigue FUERA del catálogo de telemetría,
/// igual que el passthrough JS (`docs/TELEMETRIA.md`): es analítica de
/// producto (`coach_float.*`). La ventana se toma del webview que invoca, no
/// del payload, así que un caller no puede hacerse pasar por otra ventana.
/// Nunca falla hacia el frontend: un payload inválido se anota en el log y
/// se descarta — telemetría jamás rompe la UI.
#[tauri::command]
pub async fn log_analytics_event<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    app: AppHandle<R>,
    event_type: String,
    event_data: Option<serde_json::Value>,
) -> Result<(), String> {
    let payload = match validate_analytics_event(&event_type, event_data) {
        Ok(p) => p,
        Err(reason) => {
            log::warn!(
                "[telemetry] log_analytics_event descartado desde '{}': {}",
                window.label(),
                reason
            );
            return Ok(());
        }
    };
    let meeting_id = payload
        .get("meeting_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    emit_webview_event(&app, window.label(), &event_type, payload, meeting_id.as_deref()).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn acepta_un_evento_de_producto_con_propiedades_string() {
        let payload = validate_analytics_event(
            "coach_float.drawer_toggled",
            Some(json!({ "open": "true", "reason": "user" })),
        )
        .expect("evento válido");
        assert_eq!(payload["reason"], "user");
    }

    #[test]
    fn sin_event_data_el_payload_es_un_objeto_vacio_para_que_quepa_el_ctx() {
        assert_eq!(validate_analytics_event("a.b", None).unwrap(), json!({}));
        assert_eq!(
            validate_analytics_event("a.b", Some(serde_json::Value::Null)).unwrap(),
            json!({})
        );
    }

    #[test]
    fn rechaza_nombres_vacios_largos_o_con_caracteres_raros() {
        assert!(validate_analytics_event("", None).is_err());
        assert!(validate_analytics_event(&"x".repeat(ANALYTICS_EVENT_TYPE_MAX_LEN + 1), None).is_err());
        assert!(validate_analytics_event("coach float", None).is_err());
        assert!(validate_analytics_event("coach_float.window_closed", None).is_ok());
    }

    #[test]
    fn rechaza_payloads_que_no_son_objeto_o_pasan_del_tope() {
        assert!(validate_analytics_event("a.b", Some(json!([1, 2]))).is_err());
        assert!(validate_analytics_event("a.b", Some(json!("texto"))).is_err());
        let grande = json!({ "k": "v".repeat(ANALYTICS_PAYLOAD_MAX_BYTES) });
        assert!(validate_analytics_event("a.b", Some(grande)).is_err());
    }
}
