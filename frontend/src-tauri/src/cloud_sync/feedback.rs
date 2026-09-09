//! Sync best-effort de `user_feedback` (SQLite) → RPC `public.insert_user_feedback`.
//!
//! Hasta sep-2026 la RPC la hacía cada webview con supabase-js justo después
//! de `save_user_feedback` (coach-float y `SessionFeedbackModal`). Eso metía
//! supabase-js al bundle del coach-float (#23 de la auditoría de recursos) y,
//! como `lib/supabase.ts` es un Proxy perezoso, instanciaba un SEGUNDO cliente
//! GoTrue con `autoRefreshToken` en esa ventana. Ahora Rust es el ÚNICO
//! escritor de la RPC: el comando guarda en SQLite y llama a `spawn_sync`.
//!
//! Semántica: paridad con lo que hacía el JS — fire-and-forget, un intento,
//! sin outbox. Sin sesión nativa o con el token rechazado se anota en `debug`
//! y se descarta: la fila local es la autoritativa. Si algún día hace falta
//! durabilidad, va por un outbox propio, NO por `recording_logs` (ese drena a
//! `insert_platform_log` y tiene single writer).

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::cloud_sync::session::get_valid_token;
use crate::cloud_sync::worker::{classify_error, Disposition};
use crate::cloud_sync::CloudSyncState;

/// Fila recién insertada en `user_feedback` (los mismos campos que el INSERT).
#[derive(Debug, Clone)]
pub struct FeedbackRow {
    pub id: String,
    pub feedback_type: String,
    pub rating: Option<String>,
    pub message: Option<String>,
    pub meeting_id: Option<String>,
    /// JSON serializado por el frontend (o `None`).
    pub metadata: Option<String>,
}

/// Cuerpo de la RPC. Pura para poder testearla.
///
/// - `p_message`: `message`, o `rating` si no hay mensaje (lo que mandaba
///   `SessionFeedbackModal`: `message.trim() || selected`; el coach-float pasa
///   el texto del tip como `message`).
/// - `p_metadata`: `{platform, rating, meeting_id}` ∪ metadata del frontend
///   (sus claves ganan). Un metadata que no sea objeto JSON viaja como `raw`
///   en vez de perderse.
pub fn feedback_rpc_body(row: &FeedbackRow) -> Value {
    let mut metadata = serde_json::Map::new();
    metadata.insert("platform".into(), json!("desktop"));
    metadata.insert("rating".into(), json!(row.rating));
    metadata.insert("meeting_id".into(), json!(row.meeting_id));
    if let Some(raw) = row.metadata.as_deref() {
        match serde_json::from_str::<Value>(raw) {
            Ok(Value::Object(extra)) => {
                for (k, v) in extra {
                    metadata.insert(k, v);
                }
            }
            Ok(other) => {
                metadata.insert("raw".into(), other);
            }
            Err(_) => {
                metadata.insert("raw".into(), Value::String(raw.to_string()));
            }
        }
    }
    json!({
        "p_id": row.id,
        "p_feedback_type": row.feedback_type,
        "p_message": row.message.clone().or_else(|| row.rating.clone()),
        "p_metadata": Value::Object(metadata),
    })
}

/// Lanza el sync en background. Nunca bloquea ni propaga error al comando.
pub fn spawn_sync<R: Runtime>(app: &AppHandle<R>, row: FeedbackRow) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(reason) = sync_once(&app, &row).await {
            log::warn!(
                "[feedback-sync] {} ({}) no sincronizado: {}",
                row.feedback_type,
                row.id,
                reason
            );
        }
    });
}

async fn sync_once<R: Runtime>(app: &AppHandle<R>, row: &FeedbackRow) -> Result<(), String> {
    // Sesión Supabase nativa (la siembra el frontend con cloud_sync_set_session).
    let session = match app.try_state::<CloudSyncState>() {
        Some(cloud) => cloud.snapshot().await,
        None => None,
    };
    let Some(session) = session else {
        log::debug!("[feedback-sync] sin sesión nativa; {} queda solo local", row.id);
        return Ok(());
    };
    let token = match get_valid_token(app).await {
        Ok(t) => t,
        Err(e) => {
            return match classify_error(&e) {
                Disposition::AuthDefer | Disposition::QuotaDefer => {
                    log::debug!("[feedback-sync] auth diferido para {}: {}", row.id, e);
                    Ok(())
                }
                _ => Err(format!("token: {}", e)),
            };
        }
    };

    // El RPC vive en `public` (perímetro mediado, ver CLAUDE.md): sin
    // `Content-Profile`. Mismo molde que telemetry/drain.rs::post_row.
    let url = format!(
        "{}/rest/v1/rpc/insert_user_feedback",
        session.supabase_url.trim_end_matches('/')
    );
    let response = crate::api::HTTP
        .post(&url)
        .header("apikey", &session.anon_key)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&feedback_rpc_body(row))
        .send()
        .await
        .map_err(|e| format!("red: {}", e))?;

    let status = response.status();
    if status.is_success() {
        log::info!("[feedback-sync] {} ({}) sincronizado", row.feedback_type, row.id);
        return Ok(());
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        log::debug!("[feedback-sync] {} rechazado con {}; queda solo local", row.id, status);
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "HTTP {}: {}",
        status,
        body.chars().take(200).collect::<String>()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> FeedbackRow {
        FeedbackRow {
            id: "f-1".into(),
            feedback_type: "coach_tip_feedback".into(),
            rating: Some("like".into()),
            message: Some("Deja hablar al otro".into()),
            meeting_id: Some("m-9".into()),
            metadata: Some(r#"{"tip_key":"300-type-3","tip_text":"Deja hablar al otro"}"#.into()),
        }
    }

    #[test]
    fn el_cuerpo_lleva_id_tipo_mensaje_y_metadata_fusionada() {
        let body = feedback_rpc_body(&row());
        assert_eq!(body["p_id"], "f-1");
        assert_eq!(body["p_feedback_type"], "coach_tip_feedback");
        assert_eq!(body["p_message"], "Deja hablar al otro");
        let meta = &body["p_metadata"];
        assert_eq!(meta["platform"], "desktop");
        assert_eq!(meta["rating"], "like");
        assert_eq!(meta["meeting_id"], "m-9");
        assert_eq!(meta["tip_key"], "300-type-3");
        assert_eq!(meta["tip_text"], "Deja hablar al otro");
    }

    #[test]
    fn sin_mensaje_el_rating_es_el_p_message_como_hacia_session_feedback_modal() {
        let r = FeedbackRow {
            feedback_type: "session_rating".into(),
            rating: Some("useful".into()),
            message: None,
            meeting_id: None,
            metadata: None,
            ..row()
        };
        let body = feedback_rpc_body(&r);
        assert_eq!(body["p_message"], "useful");
        assert_eq!(body["p_metadata"]["meeting_id"], Value::Null);
        assert_eq!(body["p_metadata"]["rating"], "useful");
    }

    #[test]
    fn sin_mensaje_ni_rating_el_p_message_es_null() {
        let r = FeedbackRow { rating: None, message: None, ..row() };
        assert_eq!(feedback_rpc_body(&r)["p_message"], Value::Null);
    }

    #[test]
    fn metadata_que_no_es_objeto_viaja_como_raw_en_vez_de_perderse() {
        let arr = FeedbackRow { metadata: Some("[1,2]".into()), ..row() };
        assert_eq!(feedback_rpc_body(&arr)["p_metadata"]["raw"], json!([1, 2]));
        let text = FeedbackRow { metadata: Some("no es json".into()), ..row() };
        assert_eq!(feedback_rpc_body(&text)["p_metadata"]["raw"], "no es json");
        // Los campos base sobreviven en ambos casos.
        assert_eq!(feedback_rpc_body(&text)["p_metadata"]["platform"], "desktop");
    }

    #[test]
    fn las_claves_del_frontend_ganan_sobre_las_base() {
        let r = FeedbackRow { metadata: Some(r#"{"platform":"desktop-test"}"#.into()), ..row() };
        assert_eq!(feedback_rpc_body(&r)["p_metadata"]["platform"], "desktop-test");
    }
}
