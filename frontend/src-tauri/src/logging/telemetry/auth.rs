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
use tauri::{AppHandle, Runtime};

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
}
