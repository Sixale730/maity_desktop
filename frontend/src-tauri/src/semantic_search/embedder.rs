//! Cliente para Ollama embeddings API (`POST /api/embeddings`).
//! Reusa el SHARED_CLIENT del coach para evitar setup TCP repetitivo.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
struct EmbeddingsRequest<'a> {
    model: &'a str,
    prompt: &'a str,
}

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    embedding: Vec<f32>,
}

/// Llama a Ollama y devuelve el vector embed.
/// Endpoint default: http://localhost:11434
pub async fn embed_text(
    client: &reqwest::Client,
    model: &str,
    text: &str,
    endpoint: Option<&str>,
) -> Result<Vec<f32>, String> {
    let base = endpoint.unwrap_or("http://localhost:11434");
    let url = format!("{}/api/embeddings", base.trim_end_matches('/'));

    let req = EmbeddingsRequest { model, prompt: text };
    let resp = client
        .post(&url)
        .timeout(Duration::from_secs(30))
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Ollama embed request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama embed HTTP {}: {} (¿modelo {} no instalado? `ollama pull {}`)",
            status, body, model, model
        ));
    }

    let parsed: EmbeddingsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid embed response: {}", e))?;

    if parsed.embedding.is_empty() {
        return Err("Ollama returned empty embedding vector".to_string());
    }

    Ok(parsed.embedding)
}
