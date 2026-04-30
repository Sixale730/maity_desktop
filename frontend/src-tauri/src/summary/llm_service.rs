//! `SummaryLlmService` — implementacion de `LlmService` para summaries de reuniones.
//!
//! Encapsula la logica de invocar al sidecar para summaries:
//! - n_ctx: 32768 (de model_def.context_size)
//! - max_tokens: 4096 (DEFAULT_MAX_TOKENS)
//! - sampling: model_def.sampling (temp 1.0 default por modelo)
//! - timeout: 900s (GENERATION_TIMEOUT_SECS)
//!
//! Comparte el `SidecarPool` con `CoachLlmService` — si ambos usan el mismo
//! modelo, comparten sidecar; si usan modelos distintos, hay 2 procesos.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::llm::{
    error::LlmError, metrics::LlmMetrics, request::GenerationRequest,
    response::GenerationResponse, service::LlmConfig, service::LlmService, transport::SidecarPool,
};
use crate::summary::summary_engine::models::{self, ModelDef};

/// Servicio LLM optimizado para generar summaries largos (n_ctx grande, max_tokens alto).
pub struct SummaryLlmService {
    pool: Arc<SidecarPool>,
    model_def: ModelDef,
    app_data_dir: PathBuf,
    config: LlmConfig,
    metrics: LlmMetrics,
}

impl SummaryLlmService {
    /// Crea un servicio para un modelo dado. La config se deriva de
    /// `model_def` (n_ctx desde context_size, sampling desde model_def).
    pub fn new(pool: Arc<SidecarPool>, app_data_dir: PathBuf, model_def: ModelDef) -> Self {
        let config = LlmConfig {
            n_ctx: model_def.context_size,
            max_tokens: models::DEFAULT_MAX_TOKENS as u32,
            temperature: model_def.sampling.temperature,
            top_k: model_def.sampling.top_k,
            top_p: model_def.sampling.top_p,
            stop_tokens: model_def.sampling.stop_tokens.clone(),
            timeout_secs: models::GENERATION_TIMEOUT_SECS,
        };
        Self {
            pool,
            model_def,
            app_data_dir,
            config,
            metrics: LlmMetrics::new(),
        }
    }

    /// Crea el servicio buscando el modelo por nombre en `models::get_model_by_name`.
    pub fn new_from_model_name(
        pool: Arc<SidecarPool>,
        app_data_dir: PathBuf,
        model_name: &str,
    ) -> Result<Self> {
        let model_def = models::get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("Modelo desconocido: {}", model_name))?;
        Ok(Self::new(pool, app_data_dir, model_def))
    }

    /// Genera con un system_prompt + user_prompt aplicando el template del modelo.
    /// Es el path que usan los callers de summaries (no `generate()` directo).
    pub async fn generate_summary(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        let formatted = models::format_prompt(
            &self.model_def.template,
            system_prompt,
            user_prompt,
        )
        .map_err(LlmError::from)?;
        self.generate(&formatted, cancellation_token).await
    }
}

#[async_trait]
impl LlmService for SummaryLlmService {
    async fn generate(
        &self,
        prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        self.metrics.record_request();

        // Cancellation gate al inicio
        if let Some(token) = cancellation_token {
            if token.is_cancelled() {
                self.metrics.record_cancellation();
                return Err(LlmError::Cancelled);
            }
        }

        // Resolver path del modelo y spawn/reuse sidecar via pool
        let model_path = models::get_model_path(&self.app_data_dir, &self.model_def.name)
            .map_err(LlmError::from)?;
        if !model_path.exists() {
            self.metrics.record_failure();
            return Err(LlmError::ModelNotFound(format!(
                "Modelo {} no encontrado en {}",
                self.model_def.name,
                model_path.display()
            )));
        }

        let manager = self
            .pool
            .get_or_spawn(&self.model_def.name, model_path.clone())
            .await
            .map_err(LlmError::from)?;

        // Cancellation gate despues de spawn
        if let Some(token) = cancellation_token {
            if token.is_cancelled() {
                self.metrics.record_cancellation();
                return Err(LlmError::Cancelled);
            }
        }

        // Construir request con sampling del modelo
        let request = GenerationRequest::Generate {
            prompt: prompt.to_string(),
            max_tokens: Some(self.config.max_tokens as i32),
            context_size: Some(self.config.n_ctx),
            model_path: Some(model_path.to_string_lossy().to_string()),
            temperature: Some(self.config.temperature),
            top_k: Some(self.config.top_k),
            top_p: Some(self.config.top_p),
            stop_tokens: Some(self.config.stop_tokens.clone()),
        };
        let request_json = serde_json::to_string(&request)
            .with_context(|| "serializando GenerationRequest")
            .map_err(LlmError::from)?;

        let timeout = Duration::from_secs(self.config.timeout_secs);
        let started = Instant::now();

        // Race con cancellation
        let response_json = if let Some(token) = cancellation_token {
            tokio::select! {
                result = manager.send_request(request_json, timeout) => {
                    result.map_err(LlmError::from)?
                }
                _ = token.cancelled() => {
                    self.metrics.record_cancellation();
                    if let Err(e) = manager.shutdown().await {
                        log::error!("Error apagando sidecar tras cancelacion: {}", e);
                    }
                    return Err(LlmError::Cancelled);
                }
            }
        } else {
            manager
                .send_request(request_json, timeout)
                .await
                .map_err(LlmError::from)?
        };

        // Parsear respuesta
        let response: GenerationResponse =
            serde_json::from_str(&response_json).map_err(|e| {
                self.metrics.record_failure();
                LlmError::ParseError(format!("respuesta invalida: {} (raw: {})", e, response_json))
            })?;

        match response {
            GenerationResponse::Response { text, error } => {
                if let Some(err_msg) = error {
                    self.metrics.record_failure();
                    Err(LlmError::Sidecar(err_msg))
                } else {
                    let elapsed = started.elapsed().as_millis() as u64;
                    self.metrics.record_success(elapsed);
                    Ok(text)
                }
            }
            GenerationResponse::Error { message } => {
                self.metrics.record_failure();
                Err(LlmError::Sidecar(message))
            }
        }
    }

    fn model_name(&self) -> &str {
        &self.model_def.name
    }

    fn config(&self) -> LlmConfig {
        self.config.clone()
    }

    fn metrics(&self) -> &LlmMetrics {
        &self.metrics
    }
}
