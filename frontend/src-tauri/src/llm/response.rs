//! Tipos internos de respuesta del sidecar `llama-helper`.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GenerationResponse {
    Response {
        text: String,
        error: Option<String>,
    },
    Error {
        message: String,
    },
}
