//! Trait `LlmService` — interfaz comun para todos los servicios LLM.

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use super::error::LlmError;
use super::metrics::LlmMetrics;

/// Configuracion de generacion para un servicio LLM concreto.
///
/// Cada servicio (coach, summary) instancia su propia config con valores
/// adecuados a su caso de uso (ej. coach usa `n_ctx=4096` para evitar
/// reservar 640 MB de KV cache que en RTX 3050 con poca VRAM revientan).
#[derive(Debug, Clone)]
pub struct LlmConfig {
    /// Tamano de la ventana de contexto en tokens. Determina la reserva
    /// de KV cache en VRAM (lineal con n_ctx).
    pub n_ctx: u32,

    /// Maximo de tokens a generar por request.
    pub max_tokens: u32,

    /// Temperatura de sampling (0.0 = deterministico, 2.0 = muy creativo).
    pub temperature: f32,

    /// Top-K sampling (0 = desactivado).
    pub top_k: i32,

    /// Top-P (nucleus) sampling (1.0 = desactivado).
    pub top_p: f32,

    /// Tokens que detienen la generacion al aparecer.
    pub stop_tokens: Vec<String>,

    /// Timeout total de la request en segundos.
    pub timeout_secs: u64,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            n_ctx: 4096,
            max_tokens: 512,
            temperature: 1.0,
            top_k: 64,
            top_p: 0.95,
            stop_tokens: vec!["<end_of_turn>".to_string()],
            timeout_secs: 60,
        }
    }
}

/// Trait comun para servicios LLM. Coach y summary lo implementan con
/// configs y modelos diferentes pero comparten el contrato de generacion.
#[async_trait]
pub trait LlmService: Send + Sync {
    /// Genera respuesta del LLM. Cancela limpiamente si el token se dispara.
    async fn generate(
        &self,
        prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError>;

    /// Nombre del modelo activo (para logs y metricas).
    fn model_name(&self) -> &str;

    /// Configuracion actual (para debug y assertions en tests).
    fn config(&self) -> LlmConfig;

    /// Metricas acumuladas del servicio.
    fn metrics(&self) -> &LlmMetrics;
}
