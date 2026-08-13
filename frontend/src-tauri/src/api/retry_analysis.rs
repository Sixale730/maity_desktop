// api/retry_analysis.rs
//
// Tauri command para la acción `retry_analysis` del endpoint consolidado
// `/api/conversations`. Re-dispara el análisis asíncrono de una conversación.
//
// Por qué existe un comando propio en vez de reusar `finalize`
// (issues Sixale730/maity#138 y este repo #69):
//
//   - `retry_analysis` aplica `decideRetryPlan` en el servidor. Desde
//     `quota_skipped` despacha **solo `communication`** y COBRA la unidad del
//     plan vigente; desde `failed`/`processing`/`pending` despacha
//     `communication` + `minutes` sin cobrar (ya se cobró en el finalize que
//     falló).
//   - `finalize` re-despacharía TAMBIÉN la minuta, pisando una que el usuario
//     pudo haber regenerado a mano, y no pasa por esa política de cobro.
//
// El cobro vive DENTRO del endpoint, no en el cliente: por eso el camino tiene
// que ser este HTTP y no una evaluación local.

use log::{error, info, warn};
use serde::{Deserialize, Serialize};

use super::finalize::parse_quota_403;

// ============================================================================
// TYPES
// ============================================================================

/// Respuesta de `action: 'retry_analysis'`.
///
/// Todos los campos opcionales y con `#[serde(default)]` porque el endpoint
/// responde con dos shapes distintos:
///   - **202** `{ ok, conversation_id, status: 'processing' }` — se despachó.
///   - **200** `{ ok, conversation_id, skipped: "not retryable from status=..." }`
///     — la fila ya está `completed`/`skipped`, no-op deliberado.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryAnalysisResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// `'processing'` cuando el análisis quedó despachado (202).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Motivo del no-op cuando el estado no era reintentable (200).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct RetryAnalysisRequest {
    action: String,
    conversation_id: String,
}

// ============================================================================
// TAURI COMMAND
// ============================================================================

/// Re-dispara el análisis de `conversation_id` en la nube.
///
/// El endpoint marca la fila `processing` y despacha el análisis de forma
/// asíncrona, así que la respuesta llega enseguida: no hace falta el timeout
/// largo de `regenerate_minutes` (ahí sí corre un LLM dentro del request).
///
/// # Arguments
/// * `conversation_id` - UUID de la conversación en omi_conversations
/// * `access_token` - JWT de Supabase de la sesión autenticada
#[tauri::command]
pub async fn retry_analysis_cloud(
    conversation_id: String,
    access_token: String,
) -> Result<RetryAnalysisResponse, String> {
    info!("Calling retry_analysis for conversation: {}", conversation_id);

    let client = reqwest::Client::new();
    let response = client
        .post("https://www.maity.cloud/api/conversations")
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&RetryAnalysisRequest {
            action: "retry_analysis".to_string(),
            conversation_id: conversation_id.clone(),
        })
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            error!("Network error calling retry_analysis: {}", e);
            format!(
                "network:Error de conexión al reintentar el análisis. Verifica tu internet. ({})",
                e
            )
        })?;

    let status = response.status();
    info!("retry_analysis response status: {}", status);

    if status == reqwest::StatusCode::UNAUTHORIZED {
        warn!("Got 401 from retry_analysis - session may be expired");
        return Err(
            "auth:Tu sesión ha expirado. Por favor cierra sesión y vuelve a iniciar.".to_string(),
        );
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        // Dos 403 distintos: cuota del plan agotada (el caso esperado al
        // reintentar desde `quota_skipped` sin haber hecho upgrade) y
        // ownership. El prefijo `quota:` es el que lee `parseQuotaError` en el
        // frontend para mostrar el mensaje del plan en vez de un error.
        let body = response.text().await.unwrap_or_default();

        if let Some(payload) = parse_quota_403(&body) {
            warn!(
                "Got 403 QUOTA_EXCEEDED from retry_analysis for {}: {}",
                conversation_id, payload
            );
            return Err(format!("quota:{}", payload));
        }

        warn!("Got 403 from retry_analysis - user is not the owner ({})", body);
        return Err("auth:No tienes permiso para analizar esta conversación.".to_string());
    }

    if status == reqwest::StatusCode::NOT_FOUND {
        warn!("Got 404 from retry_analysis - conversation not found");
        return Err(format!(
            "not_found:Conversación {} no encontrada.",
            conversation_id
        ));
    }

    if status == reqwest::StatusCode::BAD_REQUEST {
        let body = response.text().await.unwrap_or_default();
        warn!("Got 400 from retry_analysis: {} - {}", status, body);
        return Err(format!(
            "validation:No se pudo reintentar el análisis de esta conversación. ({})",
            body
        ));
    }

    if status.is_server_error() {
        let body = response.text().await.unwrap_or_default();
        error!("Server error from retry_analysis: {} - {}", status, body);
        return Err(format!(
            "server:Error del servidor al reintentar el análisis ({})",
            status
        ));
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("Unexpected status from retry_analysis: {} - {}", status, body);
        return Err(format!("unknown:HTTP {} - {}", status, body));
    }

    let data: RetryAnalysisResponse = response.json().await.map_err(|e| {
        error!("Failed to parse retry_analysis response: {}", e);
        format!("server:Respuesta del servidor inválida: {}", e)
    })?;

    if data.ok {
        info!(
            "retry_analysis ok: conversation={}, status={:?}, skipped={:?}",
            conversation_id, data.status, data.skipped
        );
    } else {
        warn!("retry_analysis returned ok=false: {:?}", data.error);
    }

    Ok(data)
}
