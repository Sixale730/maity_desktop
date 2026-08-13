// api/finalize.rs
//
// Tauri command to call the conversations-finalize endpoint on Vercel.
// This replaces the previous deepseek-evaluate Edge Function call.
// The endpoint evaluates the conversation, generates embeddings, memories,
// and daily scores — all written directly to Supabase server-side.

use log::{info, warn, error};
use serde::{Deserialize, Serialize};

// ============================================================================
// TYPES
// ============================================================================

/// Response from the conversations-finalize Vercel API endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalizeResponse {
    pub ok: bool,
    pub conversation_id: Option<String>,
    pub discarded: Option<bool>,
    pub words_count: Option<u32>,
    pub segments_count: Option<u32>,
    pub error: Option<String>,
}

/// Body de error del ApiError de Vercel. Parseado defensivamente: todos los
/// campos son opcionales porque el shape no está garantizado.
#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    #[allow(dead_code)]
    error: Option<String>,
    code: Option<String>,
    details: Option<QuotaDetails>,
}

#[derive(Debug, Deserialize)]
struct QuotaDetails {
    feature: Option<String>,
    used: Option<i64>,
    limit: Option<i64>,
    period: Option<String>,
}

/// Request body for the consolidated conversations endpoint
#[derive(Debug, Serialize)]
struct FinalizeRequest {
    action: String,
    conversation_id: String,
    duration_seconds: f64,
    /// Modo Ponente: 'presentation' | 'conversation'. El endpoint lo guarda en
    /// omi_conversations.recording_mode para que el análisis V4 no penalice al
    /// ponente por "acaparar" (ver issue Sixale730/maity#127). Se omite del JSON
    /// si es None para no romper compatibilidad con el endpoint actual.
    #[serde(skip_serializing_if = "Option::is_none")]
    recording_mode: Option<String>,
}

// ============================================================================
// IMPLEMENTACIÓN (invocable desde Rust)
// ============================================================================

/// Cuerpo real del finalize, separado del `#[tauri::command]` para que el
/// consumidor headless de `cloud_sync` pueda llamarlo sin pasar por el webview.
///
/// El `access_token` sigue siendo un PARÁMETRO (no se resuelve adentro): el path
/// JS le pasa el de `supabase.auth.getSession()` y el worker de Rust el de
/// `cloud_sync::get_valid_token`, sin que este módulo tenga que conocer el
/// estado de sesión.
///
/// The endpoint reads transcript segments from Supabase, evaluates with LLM
/// (DeepSeek → OpenAI fallback), generates embeddings, memories, and daily scores,
/// then writes everything back to Supabase.
///
/// # Arguments
/// * `conversation_id` - UUID of the conversation in omi_conversations
/// * `duration_seconds` - Duration of the conversation in seconds
/// * `access_token` - Supabase JWT from the authenticated user session
pub async fn finalize_impl(
    conversation_id: String,
    duration_seconds: f64,
    access_token: String,
    recording_mode: Option<String>,
) -> Result<FinalizeResponse, String> {
    info!(
        "Calling conversations-finalize for conversation: {} (duration: {:.0}s, mode: {:?})",
        conversation_id, duration_seconds, recording_mode
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://www.maity.cloud/api/conversations")
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&FinalizeRequest {
            action: "finalize".to_string(),
            conversation_id: conversation_id.clone(),
            duration_seconds,
            recording_mode,
        })
        .send()
        .await
        .map_err(|e| {
            error!("Network error calling conversations-finalize: {}", e);
            format!(
                "network:Error de conexión al analizar conversación. Verifica tu internet. ({})",
                e
            )
        })?;

    let status = response.status();
    info!("conversations-finalize response status: {}", status);

    if status == reqwest::StatusCode::UNAUTHORIZED {
        warn!("Got 401 from conversations-finalize - session may be expired");
        return Err(
            "auth:Tu sesión ha expirado. Por favor cierra sesión y vuelve a iniciar.".to_string(),
        );
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        // Un 403 puede ser ownership O cuota del plan (assertQuota → QUOTA_EXCEEDED).
        // Leemos el body para distinguir; si no parsea, conservamos el caso ownership.
        let body = response.text().await.unwrap_or_default();
        let parsed: Option<ApiErrorBody> = serde_json::from_str(&body).ok();

        if let Some(err_body) = parsed {
            if err_body.code.as_deref() == Some("QUOTA_EXCEEDED") {
                let details = err_body.details;
                let payload = serde_json::json!({
                    "message": "Alcanzaste el límite de análisis de tu plan. La minuta se genera igual.",
                    "feature": details.as_ref().and_then(|d| d.feature.clone()),
                    "used": details.as_ref().and_then(|d| d.used),
                    "limit": details.as_ref().and_then(|d| d.limit),
                    "period": details.as_ref().and_then(|d| d.period.clone()),
                });
                warn!(
                    "Got 403 QUOTA_EXCEEDED from conversations-finalize for {}: {}",
                    conversation_id, payload
                );
                return Err(format!("quota:{}", payload));
            }
        }

        warn!(
            "Got 403 from conversations-finalize - user is not the owner ({})",
            body
        );
        return Err("auth:No tienes permiso para analizar esta conversación.".to_string());
    }

    if status == reqwest::StatusCode::NOT_FOUND {
        warn!("Got 404 from conversations-finalize - conversation not found");
        return Err(format!(
            "not_found:Conversación {} no encontrada.",
            conversation_id
        ));
    }

    if status == reqwest::StatusCode::BAD_REQUEST {
        let body = response.text().await.unwrap_or_default();
        warn!(
            "Got 400 from conversations-finalize: {} - {}",
            status, body
        );
        return Err(format!(
            "validation:La conversación no tiene segmentos de transcripción. ({})",
            body
        ));
    }

    if status.is_server_error() {
        let body = response.text().await.unwrap_or_default();
        error!(
            "Server error from conversations-finalize: {} - {}",
            status, body
        );
        return Err(format!(
            "server:Error del servidor al analizar conversación ({})",
            status
        ));
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!(
            "Unexpected status from conversations-finalize: {} - {}",
            status, body
        );
        return Err(format!("unknown:HTTP {} - {}", status, body));
    }

    // Parse the response
    let data: FinalizeResponse = response.json().await.map_err(|e| {
        error!("Failed to parse conversations-finalize response: {}", e);
        format!("server:Respuesta del servidor inválida: {}", e)
    })?;

    if data.ok {
        info!(
            "conversations-finalize completed: conversation={}, words={:?}, segments={:?}, discarded={:?}",
            conversation_id, data.words_count, data.segments_count, data.discarded
        );
    } else {
        warn!(
            "conversations-finalize returned ok=false: {:?}",
            data.error
        );
    }

    Ok(data)
}

// ============================================================================
// TAURI COMMAND
// ============================================================================

/// Wrapper delgado sobre [`finalize_impl`]. La firma del comando NO cambia: el
/// frontend (reintentos manuales desde la UI) lo sigue invocando igual.
#[tauri::command]
pub async fn finalize_conversation_cloud(
    conversation_id: String,
    duration_seconds: f64,
    access_token: String,
    recording_mode: Option<String>,
) -> Result<FinalizeResponse, String> {
    finalize_impl(
        conversation_id,
        duration_seconds,
        access_token,
        recording_mode,
    )
    .await
}
