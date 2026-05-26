// api/regenerate_minutes.rs
//
// Tauri command to call the conversations endpoint on Vercel with
// action="generate-minutes" to (re)generate the meeting minutes for a
// conversation. The endpoint is idempotent — it overwrites
// meeting_minutes_data with a fresh Minuta_v2 payload.
//
// Auth model on the cloud side:
//   - Owner (user_id == authenticated user) can regenerate their own
//     conversation. Admins can regenerate any conversation.
//   - Non-admins are rate-limited (MINUTES_REGEN_PER_DAY, default 10/day,
//     counted by distinct conversations regenerated in a rolling 24h).

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// TYPES
// ============================================================================

/// Response from the `generate-minutes` action of the consolidated
/// conversations endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegenerateMinutesResponse {
    pub ok: bool,
    pub conversation_id: Option<String>,
    /// Raw Minuta_v2 JSON payload. The frontend re-uses the existing
    /// `AnyMeetingMinutesData` types to render — we don't reflect the
    /// schema in Rust to avoid drift between sides.
    pub meeting_minutes_data: Option<Value>,
    pub processing_time_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct RegenerateMinutesRequest {
    action: String,
    conversation_id: String,
}

// ============================================================================
// TAURI COMMAND
// ============================================================================

/// Triggers a server-side meeting-minutes regeneration for `conversation_id`.
/// Returns the freshly produced minute payload (Minuta_v2 shape) on success.
///
/// # Arguments
/// * `conversation_id` - UUID of the conversation in omi_conversations
/// * `access_token` - Supabase JWT from the authenticated user session
#[tauri::command]
pub async fn regenerate_minutes_cloud(
    conversation_id: String,
    access_token: String,
) -> Result<RegenerateMinutesResponse, String> {
    info!(
        "Calling generate-minutes for conversation: {}",
        conversation_id
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://www.maity.cloud/api/conversations")
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&RegenerateMinutesRequest {
            action: "generate-minutes".to_string(),
            conversation_id: conversation_id.clone(),
        })
        // LLM call inside — Vercel Fluid Compute allows up to 300s. Keep
        // client-side slack above what the server budgets internally.
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|e| {
            error!("Network error calling generate-minutes: {}", e);
            format!(
                "network:Error de conexión al regenerar la minuta. Verifica tu internet. ({})",
                e
            )
        })?;

    let status = response.status();
    info!("generate-minutes response status: {}", status);

    if status == reqwest::StatusCode::UNAUTHORIZED {
        warn!("Got 401 from generate-minutes - session may be expired");
        return Err(
            "auth:Tu sesión ha expirado. Por favor cierra sesión y vuelve a iniciar.".to_string(),
        );
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        warn!("Got 403 from generate-minutes - user is not the owner");
        return Err("auth:Solo puedes regenerar la minuta de tus propias conversaciones.".to_string());
    }

    if status == reqwest::StatusCode::NOT_FOUND {
        warn!("Got 404 from generate-minutes - conversation not found");
        return Err(format!(
            "not_found:Conversación {} no encontrada.",
            conversation_id
        ));
    }

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let body = response.text().await.unwrap_or_default();
        warn!("Got 429 from generate-minutes (rate limit): {}", body);
        return Err(
            "rate_limit:Has alcanzado el límite diario de regeneraciones. Intenta mañana."
                .to_string(),
        );
    }

    if status == reqwest::StatusCode::BAD_REQUEST {
        let body = response.text().await.unwrap_or_default();
        warn!("Got 400 from generate-minutes: {} - {}", status, body);
        return Err(format!(
            "validation:La conversación no tiene segmentos suficientes para generar minuta. ({})",
            body
        ));
    }

    if status.is_server_error() {
        let body = response.text().await.unwrap_or_default();
        error!(
            "Server error from generate-minutes: {} - {}",
            status, body
        );
        return Err(format!(
            "server:Error del servidor al regenerar minuta ({})",
            status
        ));
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!(
            "Unexpected status from generate-minutes: {} - {}",
            status, body
        );
        return Err(format!("unknown:HTTP {} - {}", status, body));
    }

    let data: RegenerateMinutesResponse = response.json().await.map_err(|e| {
        error!("Failed to parse generate-minutes response: {}", e);
        format!("server:Respuesta del servidor inválida: {}", e)
    })?;

    if data.ok {
        info!(
            "generate-minutes completed: conversation={}, took={:?}ms",
            conversation_id, data.processing_time_ms
        );
    } else {
        warn!(
            "generate-minutes returned ok=false: {:?}",
            data.error
        );
    }

    Ok(data)
}
