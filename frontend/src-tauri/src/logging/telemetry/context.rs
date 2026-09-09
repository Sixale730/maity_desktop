//! Identidad canónica de la telemetría: install_id, session_id de proceso y
//! app_version. La consumen los emisores Rust (vía `ctx_value`) y el frontend
//! (vía el comando `get_telemetry_context` + `lib/telemetryContext.ts`).

use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Versión del envelope `ctx`. Subirla solo con un cambio incompatible de forma.
pub const CTX_SCHEMA_VERSION: u32 = 1;

const STORE_FILE: &str = "telemetry.json";
const INSTALL_ID_KEY: &str = "install_id";

#[derive(Debug, Clone, Serialize)]
pub struct TelemetryContext {
    pub install_id: String,
    /// true si el store existía pero su install_id era ilegible/corrupto y hubo
    /// que regenerarlo — distingue "usuario nuevo" de "store perdido" en el
    /// análisis (el corte post-release NO es churn).
    pub install_id_regenerated: bool,
    pub app_version: String,
    /// Id de PROCESO (`proc-<epoch_ms>-<rand>`): uno por arranque de la app,
    /// compartido por todas las ventanas y por los emisores Rust. El id de
    /// grabación (`session-…`) es otro nivel y viaja como
    /// `recording_session_id` dentro del payload.
    pub session_id: String,
}

static PROCESS_SESSION_ID: OnceLock<String> = OnceLock::new();
static INSTALL_ID: OnceLock<(String, bool)> = OnceLock::new();

pub fn process_session_id() -> &'static str {
    PROCESS_SESSION_ID.get_or_init(|| {
        let ts = chrono::Utc::now().timestamp_millis();
        let rand = &uuid::Uuid::new_v4().simple().to_string()[..8];
        format!("proc-{}-{}", ts, rand)
    })
}

/// install_id persistente. Nunca falla: si el store es ilegible, degrada a un
/// id efímero de proceso marcado como regenerado — la telemetría no bloquea.
fn resolve_install_id<R: Runtime>(app: &AppHandle<R>) -> (String, bool) {
    INSTALL_ID
        .get_or_init(|| load_or_create_install_id(app))
        .clone()
}

fn load_or_create_install_id<R: Runtime>(app: &AppHandle<R>) -> (String, bool) {
    match app.store(STORE_FILE) {
        Ok(store) => {
            let existing = store
                .get(INSTALL_ID_KEY)
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            match existing {
                Some(id) if uuid::Uuid::parse_str(&id).is_ok() => (id, false),
                had_key => {
                    // Ausente (instalación nueva) o corrupto (store dañado).
                    let regenerated = had_key.is_some();
                    let id = uuid::Uuid::new_v4().to_string();
                    store.set(INSTALL_ID_KEY, serde_json::Value::String(id.clone()));
                    if let Err(e) = store.save() {
                        log::warn!("[telemetry] no se pudo persistir install_id: {}", e);
                    }
                    (id, regenerated)
                }
            }
        }
        Err(e) => {
            log::warn!("[telemetry] store {} ilegible: {}", STORE_FILE, e);
            (uuid::Uuid::new_v4().to_string(), true)
        }
    }
}

pub fn context<R: Runtime>(app: &AppHandle<R>) -> TelemetryContext {
    let (install_id, install_id_regenerated) = resolve_install_id(app);
    TelemetryContext {
        install_id,
        install_id_regenerated,
        // package_info es compile-time: siempre resuelve. La regla "jamás
        // 'unknown'" aplica al frontend, que sí puede fallar en resolverla.
        app_version: app.package_info().version.to_string(),
        session_id: process_session_id().to_string(),
    }
}

/// Envelope `ctx` para eventos emitidos DESDE Rust (`emitter: "rust"`,
/// `window: null`). `occurred_at` es el event time — `created_at` de la tabla
/// es el ingest time y pueden diferir horas en jornada offline.
pub fn ctx_value<R: Runtime>(app: &AppHandle<R>) -> serde_json::Value {
    ctx_from_parts(&context(app), "rust", None)
}

/// Envelope `ctx` para eventos que NACEN en un webview pero viajan por el
/// outbox nativo (comando `log_analytics_event`, ventanas aux — #23 de la
/// auditoría). Conserva la etiqueta que ponía `buildCtx` del JS
/// (`emitter: "webview"`, `window: <label>`): `emitter` describe dónde nació el
/// evento, no por dónde viajó, así que las queries por `ctx` no cambian.
pub fn ctx_value_from_window<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
) -> serde_json::Value {
    ctx_from_parts(&context(app), "webview", Some(window_label))
}

/// Pura (sin `AppHandle`) para poder testearla.
pub(crate) fn ctx_from_parts(
    c: &TelemetryContext,
    emitter: &str,
    window: Option<&str>,
) -> serde_json::Value {
    let mut ctx = serde_json::json!({
        "install_id": c.install_id,
        "app_version": c.app_version,
        "session_id": c.session_id,
        "emitter": emitter,
        "window": window,
        "occurred_at": chrono::Utc::now().to_rfc3339(),
        "schema": CTX_SCHEMA_VERSION,
    });
    if c.install_id_regenerated {
        if let Some(obj) = ctx.as_object_mut() {
            obj.insert("install_id_regenerated".into(), serde_json::Value::Bool(true));
        }
    }
    ctx
}

#[cfg(test)]
mod ctx_tests {
    use super::*;

    fn sample(regenerated: bool) -> TelemetryContext {
        TelemetryContext {
            install_id: "11111111-2222-4333-8444-555555555555".into(),
            install_id_regenerated: regenerated,
            app_version: "0.2.58".into(),
            session_id: "proc-1-abcd".into(),
        }
    }

    #[test]
    fn el_ctx_de_rust_lleva_emitter_rust_y_window_null() {
        let ctx = ctx_from_parts(&sample(false), "rust", None);
        assert_eq!(ctx["emitter"], "rust");
        assert_eq!(ctx["window"], serde_json::Value::Null);
        assert_eq!(ctx["session_id"], "proc-1-abcd");
        assert_eq!(ctx["schema"], CTX_SCHEMA_VERSION);
        assert!(ctx.get("install_id_regenerated").is_none());
        assert!(ctx["occurred_at"].as_str().is_some());
    }

    #[test]
    fn el_ctx_de_una_ventana_conserva_la_etiqueta_del_webview() {
        let ctx = ctx_from_parts(&sample(true), "webview", Some("coach-float"));
        assert_eq!(ctx["emitter"], "webview");
        assert_eq!(ctx["window"], "coach-float");
        assert_eq!(ctx["install_id_regenerated"], true);
        assert_eq!(ctx["app_version"], "0.2.58");
    }
}

#[tauri::command]
pub fn get_telemetry_context<R: Runtime>(app: AppHandle<R>) -> TelemetryContext {
    context(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_session_id_es_estable_y_con_formato() {
        let a = process_session_id();
        let b = process_session_id();
        assert_eq!(a, b, "el id de proceso debe ser estable dentro del proceso");
        assert!(a.starts_with("proc-"), "{}", a);
        let parts: Vec<&str> = a.splitn(3, '-').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts[1].parse::<i64>().is_ok(), "epoch ms: {}", parts[1]);
        assert_eq!(parts[2].len(), 8, "sufijo aleatorio: {}", parts[2]);
    }
}
