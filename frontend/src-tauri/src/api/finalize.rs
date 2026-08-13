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
///
/// `analysis_status` y `quota` son ADITIVOS y llegan con `#[serde(default)]`
/// porque el endpoint puede no mandarlos (versiones viejas de la web, o el
/// caso normal en que sí hay cuota). Desde issue Sixale730/maity#132 la cuota
/// NO gatea el finalize: la minuta se genera igual y la nube responde **200**
/// con `analysis_status:'quota_skipped'` + un objeto `quota`
/// (`{feature, reason, used, limit, period}`). Antes de esto el desktop tiraba
/// esa señal a la basura — el job quedaba `completed` y el usuario nunca se
/// enteraba de por qué no llegaba el análisis.
///
/// El 403 `QUOTA_EXCEEDED` (más abajo, prefijo `quota:`) es el camino LEGACY:
/// se conserva para jobs viejos y para el reanálisis manual.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalizeResponse {
    pub ok: bool,
    pub conversation_id: Option<String>,
    pub discarded: Option<bool>,
    pub words_count: Option<u32>,
    pub segments_count: Option<u32>,
    pub error: Option<String>,
    /// `quota_skipped` | `pending` | `processing` | `completed` | … tal cual lo
    /// mandó la nube. Se guarda en `result_data` y lo expone la lista vía
    /// `api_get_meetings_overview`; `derivePhase` lo trata como terminal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis_status: Option<String>,
    /// Detalle de la cuota agotada (shape libre: `{feature, reason, used,
    /// limit, period}`). `Value` a propósito: si la web agrega campos, viajan
    /// hasta el `result_data` sin tocar Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota: Option<serde_json::Value>,
}

/// Body de error del ApiError de Vercel. Parseado defensivamente: todos los
/// campos son opcionales porque el shape no está garantizado.
///
/// El campo que lleva el código es **`error`**: `ApiError::send()` en la web
/// responde `{ error: <ApiErrorCode>, message, details }`. `code` se conserva
/// solo como fallback legacy — hasta ago-2026 este módulo leía únicamente
/// `code`, que NO existe en el body, así que TODO 403 de cuota se clasificaba
/// como problema de ownership y el usuario veía "No tienes permiso para
/// analizar esta conversación" en vez del mensaje del plan.
#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorBody {
    error: Option<String>,
    code: Option<String>,
    details: Option<QuotaDetails>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct QuotaDetails {
    feature: Option<String>,
    used: Option<i64>,
    limit: Option<i64>,
    period: Option<String>,
}

/// Distingue un 403 de cuota (`QUOTA_EXCEEDED`) de uno de ownership.
///
/// Devuelve el payload JSON que viaja tras el prefijo `quota:` — el contrato
/// que `parseQuotaError` (`lib/quotaErrors.ts`) y `quota_period`
/// (`cloud_sync/worker.rs`) esperan — o `None` si el 403 es de otra cosa o el
/// body no parsea. Compartido por todos los llamadores del endpoint
/// `/api/conversations` para que el shape se lea en un solo lugar.
pub(crate) fn parse_quota_403(body: &str) -> Option<String> {
    let err_body: ApiErrorBody = serde_json::from_str(body).ok()?;

    let code = err_body.error.as_deref().or(err_body.code.as_deref())?;
    if code != "QUOTA_EXCEEDED" {
        return None;
    }

    let details = err_body.details;
    Some(
        serde_json::json!({
            "message": "Alcanzaste el límite de análisis de tu plan. La minuta se genera igual.",
            "feature": details.as_ref().and_then(|d| d.feature.clone()),
            "used": details.as_ref().and_then(|d| d.used),
            "limit": details.as_ref().and_then(|d| d.limit),
            "period": details.as_ref().and_then(|d| d.period.clone()),
        })
        .to_string(),
    )
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

        if let Some(payload) = parse_quota_403(&body) {
            warn!(
                "Got 403 QUOTA_EXCEEDED from conversations-finalize for {}: {}",
                conversation_id, payload
            );
            return Err(format!("quota:{}", payload));
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
            "conversations-finalize completed: conversation={}, words={:?}, segments={:?}, discarded={:?}, analysis_status={:?}",
            conversation_id, data.words_count, data.segments_count, data.discarded, data.analysis_status
        );
        // 200 con cuota agotada: NO es un error (la minuta sí se generó), pero
        // se loguea porque explica por qué la conversación se queda sin análisis.
        if data.analysis_status.as_deref() == Some("quota_skipped") {
            warn!(
                "conversations-finalize omitió el análisis por cuota para {}: {:?}",
                conversation_id, data.quota
            );
        }
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

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod quota_403_tests {
    use super::parse_quota_403;

    /// Shape REAL de la web: `ApiError::send()` pone el código en `error`.
    #[test]
    fn detecta_quota_en_el_campo_error() {
        let body = r#"{"error":"QUOTA_EXCEEDED","message":"Alcanzaste tu límite","details":{"feature":"omi_conversation","used":15,"limit":15,"period":"daily"}}"#;
        let payload = parse_quota_403(body).expect("debe detectar la cuota");
        let json: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(json["feature"], "omi_conversation");
        assert_eq!(json["used"], 15);
        assert_eq!(json["limit"], 15);
        assert_eq!(json["period"], "daily");
    }

    /// Fallback legacy por si algún endpoint viejo manda `code`.
    #[test]
    fn detecta_quota_en_el_campo_code_legacy() {
        let body = r#"{"code":"QUOTA_EXCEEDED","details":{"feature":"omi_conversation","period":"monthly"}}"#;
        let payload = parse_quota_403(body).expect("debe detectar la cuota legacy");
        let json: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(json["period"], "monthly");
        assert!(json["used"].is_null());
    }

    /// Sin `details` el payload sigue siendo válido: solo el mensaje genérico.
    #[test]
    fn tolera_quota_sin_details() {
        let payload = parse_quota_403(r#"{"error":"QUOTA_EXCEEDED"}"#).expect("debe detectar");
        let json: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert!(json["message"].as_str().unwrap().contains("límite"));
        assert!(json["feature"].is_null());
    }

    /// Un 403 de ownership NO debe confundirse con cuota.
    #[test]
    fn ignora_403_de_ownership() {
        let body = r#"{"error":"FORBIDDEN","message":"Conversation does not belong to user"}"#;
        assert!(parse_quota_403(body).is_none());
    }

    #[test]
    fn ignora_body_invalido_o_vacio() {
        assert!(parse_quota_403("").is_none());
        assert!(parse_quota_403("<html>502 Bad Gateway</html>").is_none());
        assert!(parse_quota_403("{}").is_none());
    }
}
