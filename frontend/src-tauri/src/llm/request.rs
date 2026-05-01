//! Tipos internos de request al sidecar `llama-helper`.
//!
//! Espejo del `Request::Generate` que el sidecar acepta. Mantener sincronizado
//! con `summary_engine::client::Request` y con el binario `llama-helper`.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GenerationRequest {
    Generate {
        prompt: String,
        max_tokens: Option<i32>,
        context_size: Option<u32>,
        model_path: Option<String>,
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        stop_tokens: Option<Vec<String>>,
    },
}
