//! Errores tipados para el subsistema LLM.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("Sidecar error: {0}")]
    Sidecar(String),

    #[error("Generation cancelled by user")]
    Cancelled,

    #[error("Generation timeout after {0}s")]
    Timeout(u64),

    #[error("Failed to parse response: {0}")]
    ParseError(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl LlmError {
    /// Convierte cualquier error con `Display` en `LlmError::Internal`.
    /// Util para integrar con `anyhow::Error` o errores de capas inferiores.
    pub fn internal<E: std::fmt::Display>(err: E) -> Self {
        LlmError::Internal(err.to_string())
    }
}

impl From<anyhow::Error> for LlmError {
    fn from(err: anyhow::Error) -> Self {
        LlmError::Internal(err.to_string())
    }
}
