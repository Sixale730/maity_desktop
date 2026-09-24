//! Telemetría de sesión (#83, desde 0.2.62): emisor de `auth.logout` (y, desde
//! S4, de `auth.session_lost`).
//!
//! Camino: la fila se escribe al outbox durable (`emit_event_with_id`) y la ruta
//! de logout la sube de inmediato con `drain::flush_row`, usando el token de
//! QUIEN SALE (reuse-only: `flush_row` nunca refresca, porque refrescar rotaría
//! el refresh_token justo cuando la UI hace el signOut). Todo esto ocurre dentro
//! de `logout_cleanup`, ANTES de que el frontend corra `cloud_sync_clear_session`.
//!
//! Por qué `maity_user_id` va en el payload: el RPC resuelve `user_id` desde
//! `auth.uid()` AL DRENAR. Una fila que no alcanzó a subir (sin red, token sin
//! margen) se drenará más tarde y el RPC la atribuirá a quien esté logueado en
//! ese momento (otro usuario, o nadie). El campo del payload conserva la
//! identidad real de quien cerró sesión.
//!
//! Regla del módulo: nada de `log::error!` (lo recoge el puente de errores);
//! solo `warn!`/`info!`.

use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};

/// Superficies de logout aceptadas (dominio cerrado; cualquier otra ⇒ "unknown").
/// Espejo del tipo `LogoutSurface` del frontend (S3b).
pub(crate) const LOGOUT_SURFACES: &[&str] = &[
    "settings",
    "sidebar",
    "chat_sidebar",
    "onboarding_badge",
    "account_error",
    "unknown",
];

/// Normaliza la superficie que manda el webview: devuelve el `&'static str` de
/// `LOGOUT_SURFACES` que coincide EXACTO (sin trim ni lowercase); `None`, vacío
/// o desconocido ⇒ `"unknown"`. Nunca propaga texto libre del webview.
pub(crate) fn normalize_surface(surface: Option<&str>) -> &'static str {
    match surface {
        Some(s) => LOGOUT_SURFACES
            .iter()
            .copied()
            .find(|known| *known == s)
            .unwrap_or("unknown"),
        None => "unknown",
    }
}

/// Hechos del logout capturados ANTES del stop de la grabación (si se tomaran
/// después, `recording_was_active` saldría siempre `false`).
#[derive(Debug, Clone)]
pub(crate) struct LogoutFacts {
    pub surface: &'static str,
    pub maity_user_id: Option<String>,
    pub recording_was_active: bool,
    pub recording_phase: &'static str,
}

/// Payload de `auth.logout` (contrato 1.6), puro.
pub(crate) fn logout_payload(f: &LogoutFacts) -> serde_json::Value {
    json!({
        "reason": "user",
        "surface": f.surface,
        "maity_user_id": f.maity_user_id,
        "recording_was_active": f.recording_was_active,
        "recording_phase": f.recording_phase,
    })
}

/// Escribe `auth.logout` al outbox y devuelve el id de la fila (None si no se escribió).
pub(crate) async fn emit_logout<R: Runtime>(app: &AppHandle<R>, f: &LogoutFacts) -> Option<i64> {
    super::emit::emit_event_with_id(
        app,
        super::context::process_session_id(),
        super::catalog::AUTH_LOGOUT,
        logout_payload(f),
        Some(super::status::TelemetryStatus::Ok),
        None,
        None,
    )
    .await
}

// ── auth.session_lost (S4, AC-19) ────────────────────────────────────────────
//
// Solo pérdidas REALES de sesión (sin que el usuario la cerrara):
// - `webview_signed_out`: SIGNED_OUT espontáneo de supabase-js con la app viva
//   (refresh rechazado, sesión revocada).
// - `boot_no_session`: la app arranca sin sesión, hay marca persistida de un login
//   previo (`lifecycle::last_login_user`) y `getSession` NO falló por red (esa
//   decisión la toma el webview, `lib/authSessionLost.ts`).
// Nunca por red caída: un autostart antes de que suba el Wi-Fi con el token vencido
// devuelve `session: null` con un error reintentable y NO es sesión perdida.
// La emite Rust (outbox) porque sin sesión el `platformLogger` de JS no puede postear:
// la fila espera en el outbox a la siguiente siembra de sesión, y por eso lleva
// `maity_user_id` en el payload.

/// Fuentes aceptadas de `auth.session_lost` (dominio cerrado).
pub(crate) const SESSION_LOST_SOURCES: &[&str] = &["webview_signed_out", "boot_no_session"];

/// Tope del nombre de error saneado.
const ERROR_NAME_MAX_CHARS: usize = 64;

/// Regla pura: ¿se emite? Fuente desconocida ⇒ no. `boot_no_session` exige marca de
/// login previa (sin marca = primer arranque o el anterior cerró sesión limpio).
/// `webview_signed_out` ⇒ sí.
pub(crate) fn should_emit_session_lost(source: &str, has_login_marker: bool) -> bool {
    match source {
        "webview_signed_out" => true,
        "boot_no_session" => has_login_marker,
        _ => false,
    }
}

/// Nombre de error saneado: solo `[A-Za-z0-9_.]`, máx. 64 chars; vacío ⇒ `None`
/// (sin PII ni mensajes: solo el nombre de la clase, p. ej. `AuthApiError`).
pub(crate) fn sanitize_error_name(name: Option<&str>) -> Option<String> {
    let cleaned: String = name?
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.')
        .take(ERROR_NAME_MAX_CHARS)
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Payload de `auth.session_lost` (contrato 1.6), puro.
pub(crate) fn session_lost_payload(
    source: &str,
    maity_user_id: Option<&str>,
    recording_was_active: bool,
    error_name: Option<&str>,
) -> serde_json::Value {
    json!({
        "source": source,
        "maity_user_id": maity_user_id,
        "recording_was_active": recording_was_active,
        "error_name": error_name,
    })
}

/// Emite `auth.session_lost` (status `warning`) al outbox. Lo invoca el webview
/// (`invoke('telemetry_auth_session_lost', { source, errorName })`). Rust decide con la
/// marca de login: `boot_no_session` sin marca no emite. La marca se consume SOLO si la
/// fila quedó en el outbox. Nunca falla.
#[tauri::command]
pub async fn telemetry_auth_session_lost<R: Runtime>(
    app: AppHandle<R>,
    source: String,
    error_name: Option<String>,
) -> Result<(), String> {
    if !SESSION_LOST_SOURCES.contains(&source.as_str()) {
        log::warn!("auth.session_lost: fuente desconocida descartada");
        return Ok(());
    }
    let marker = super::lifecycle::peek_last_login_user();
    if !should_emit_session_lost(&source, marker.is_some()) {
        log::info!(
            "auth.session_lost: {} sin marca de login previa; no se emite",
            source
        );
        return Ok(());
    }

    // `webview_signed_out`: Rust todavía tiene al usuario (clear_current_user corre
    // después); si falta, el de la marca. `boot_no_session`: el de la marca.
    let state_user = if source == "webview_signed_out" {
        match app.try_state::<crate::state::AppState>() {
            Some(s) => s.current_user_id().await,
            None => None,
        }
    } else {
        None
    };
    let maity_user_id =
        state_user.or_else(|| marker.as_ref().map(|m| m.maity_user_id.clone()));

    let phase = crate::audio::recording_phase::current_phase();
    let recording_was_active = phase.is_session_active();
    let error_name = sanitize_error_name(error_name.as_deref());
    let payload = session_lost_payload(
        &source,
        maity_user_id.as_deref(),
        recording_was_active,
        error_name.as_deref(),
    );

    let row = super::emit::emit_event_with_id(
        &app,
        super::context::process_session_id(),
        super::catalog::AUTH_SESSION_LOST,
        payload,
        Some(super::status::TelemetryStatus::Warning),
        None,
        None,
    )
    .await;

    if row.is_some() {
        let _ = super::lifecycle::take_last_login_user();
    }
    log::info!(
        "auth.session_lost: source={} fila={:?} grabando={}",
        source,
        row,
        recording_was_active
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn facts(user: Option<&str>) -> LogoutFacts {
        LogoutFacts {
            surface: "settings",
            maity_user_id: user.map(str::to_string),
            recording_was_active: true,
            recording_phase: "recording",
        }
    }

    #[test]
    fn normalize_surface_acepta_solo_el_dominio_exacto() {
        assert_eq!(normalize_surface(Some("settings")), "settings");
        assert_eq!(normalize_surface(Some("chat_sidebar")), "chat_sidebar");
        assert_eq!(normalize_surface(None), "unknown");
        assert_eq!(normalize_surface(Some("")), "unknown");
        assert_eq!(normalize_surface(Some("Settings")), "unknown");
        assert_eq!(normalize_surface(Some("<script>")), "unknown");
    }

    #[test]
    fn normalize_surface_es_identidad_en_todo_el_dominio() {
        for s in LOGOUT_SURFACES {
            assert_eq!(normalize_surface(Some(s)), *s);
        }
    }

    #[test]
    fn logout_payload_reason_user_y_campos() {
        let p = logout_payload(&facts(None));
        assert_eq!(p["reason"], "user");
        assert_eq!(p["surface"], "settings");
        assert_eq!(p["recording_phase"], "recording");
        assert_eq!(p["recording_was_active"], true);
    }

    #[test]
    fn logout_payload_maity_user_id_null_o_string() {
        let sin = logout_payload(&facts(None));
        assert!(sin["maity_user_id"].is_null());
        assert!(sin.as_object().unwrap().contains_key("maity_user_id"));
        let con = logout_payload(&facts(Some("u1")));
        assert_eq!(con["maity_user_id"], "u1");
    }

    #[test]
    fn logout_payload_claves_exactas() {
        let p = logout_payload(&facts(Some("u1")));
        let keys: BTreeSet<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> = [
            "reason",
            "surface",
            "maity_user_id",
            "recording_was_active",
            "recording_phase",
        ]
        .into_iter()
        .collect();
        assert_eq!(keys, expected);
    }

    #[test]
    fn should_emit_session_lost_tabla() {
        assert!(!should_emit_session_lost("boot_no_session", false));
        assert!(should_emit_session_lost("boot_no_session", true));
        assert!(should_emit_session_lost("webview_signed_out", false));
        assert!(!should_emit_session_lost("native_refresh_rejected", true));
        assert!(!should_emit_session_lost("", true));
    }

    #[test]
    fn todas_las_fuentes_del_dominio_pueden_emitirse_con_marca() {
        for s in SESSION_LOST_SOURCES {
            assert!(should_emit_session_lost(s, true), "{s}");
        }
    }

    #[test]
    fn sanitize_error_name_casos() {
        assert_eq!(sanitize_error_name(None), None);
        assert_eq!(sanitize_error_name(Some("")), None);
        assert_eq!(sanitize_error_name(Some("<> ")), None);
        assert_eq!(
            sanitize_error_name(Some("AuthApiError")).as_deref(),
            Some("AuthApiError")
        );
        assert_eq!(sanitize_error_name(Some("a b<c>")).as_deref(), Some("abc"));
        assert_eq!(
            sanitize_error_name(Some("auth_js.Error_1")).as_deref(),
            Some("auth_js.Error_1")
        );
        let largo = "x".repeat(200);
        let s = sanitize_error_name(Some(&largo)).unwrap();
        assert_eq!(s.chars().count(), 64);
    }

    #[test]
    fn session_lost_payload_claves_exactas_y_nulls() {
        let p = session_lost_payload("boot_no_session", None, false, None);
        let keys: BTreeSet<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> =
            ["source", "maity_user_id", "recording_was_active", "error_name"]
                .into_iter()
                .collect();
        assert_eq!(keys, expected);
        assert_eq!(p["source"], "boot_no_session");
        assert!(p["maity_user_id"].is_null());
        assert_eq!(p["recording_was_active"], false);
        assert!(p["error_name"].is_null());

        let q = session_lost_payload("webview_signed_out", Some("u1"), true, Some("AuthApiError"));
        assert_eq!(q["source"], "webview_signed_out");
        assert_eq!(q["maity_user_id"], "u1");
        assert_eq!(q["recording_was_active"], true);
        assert_eq!(q["error_name"], "AuthApiError");
    }
}
