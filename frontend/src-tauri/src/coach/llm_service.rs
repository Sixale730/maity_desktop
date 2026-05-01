//! `CoachLlmService` — implementacion de `LlmService` para el coach.
//!
//! El coach tiene dos casos de uso con configs muy distintas:
//!
//! - `generate_tip()`: genera tips cortos en tiempo real (max 200 tokens,
//!   timeout 30s). Se llama varias veces por minuto durante la grabacion.
//! - `evaluate_meeting()`: evaluacion post-meeting con JSON rico (max 4096
//!   tokens, timeout 120s). Se llama 1 vez al cerrar la grabacion.
//!
//! Ambos casos comparten:
//! - n_ctx = 4096  (CRITICO: bajado de 32768 para que el KV cache no
//!   reviente VRAM en GPUs chicas como RTX 3050 con 3.29 GB libres)
//! - temperature = 0.3  (tips deterministicos)
//! - top_k = 64, top_p = 0.95  (sampling estandar Gemma)
//!
//! El servicio comparte el `SidecarPool` con `SummaryLlmService`. Si ambos
//! usan el mismo modelo (ej. "gemma3:4b"), comparten sidecar; si usan
//! modelos distintos (ej. coach="gemma3:1b" + summary="gemma3:4b"), hay 2
//! procesos llama-helper en paralelo.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Context;
use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::llm::{
    error::LlmError, metrics::LlmMetrics, request::GenerationRequest,
    response::GenerationResponse, service::LlmConfig, service::LlmService, transport::SidecarPool,
};
use crate::summary::summary_engine::models;

// ─── Constantes de configuracion ─────────────────────────────────────────────

/// Config para tips en vivo (cortos, frecuentes).
pub const COACH_TIP_CONFIG: CoachConfigDefaults = CoachConfigDefaults {
    n_ctx: 4096,
    max_tokens: 200,
    temperature: 0.3,
    top_k: 64,
    top_p: 0.95,
    timeout_secs: 30,
};

/// Config para evaluacion post-meeting (JSON rico).
pub const COACH_EVAL_CONFIG: CoachConfigDefaults = CoachConfigDefaults {
    n_ctx: 4096,
    max_tokens: 4096,
    temperature: 0.3,
    top_k: 64,
    top_p: 0.95,
    timeout_secs: 120,
};

/// Defaults const-friendly para configs del coach (sin Vec<String>).
pub struct CoachConfigDefaults {
    pub n_ctx: u32,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_k: i32,
    pub top_p: f32,
    pub timeout_secs: u64,
}

impl CoachConfigDefaults {
    /// Construye un `LlmConfig` con stop_tokens estandar de Gemma 3.
    pub fn to_llm_config(&self) -> LlmConfig {
        LlmConfig {
            n_ctx: self.n_ctx,
            max_tokens: self.max_tokens,
            temperature: self.temperature,
            top_k: self.top_k,
            top_p: self.top_p,
            stop_tokens: vec!["<end_of_turn>".to_string()],
            timeout_secs: self.timeout_secs,
        }
    }
}

/// Modelo coach por defecto si no hay setting en DB. Mantiene compatibilidad
/// con el setup actual (gemma3:4b descargado en onboarding).
pub const DEFAULT_COACH_MODEL: &str = "gemma3:4b";

// ─── Servicio ────────────────────────────────────────────────────────────────

pub struct CoachLlmService {
    pool: Arc<SidecarPool>,
    app_data_dir: PathBuf,
    model_name: String,
    tip_config: LlmConfig,
    eval_config: LlmConfig,
    metrics: LlmMetrics,
}

impl CoachLlmService {
    /// Crea un servicio con el modelo dado y configs default de tip/eval.
    pub fn new(pool: Arc<SidecarPool>, app_data_dir: PathBuf, model_name: String) -> Self {
        Self {
            pool,
            app_data_dir,
            model_name,
            tip_config: COACH_TIP_CONFIG.to_llm_config(),
            eval_config: COACH_EVAL_CONFIG.to_llm_config(),
            metrics: LlmMetrics::new(),
        }
    }

    /// Crea el servicio leyendo `coach_settings.tips_model_id` de la DB.
    /// Mapea el ID de coach al naming del sidecar (ej. `gemma3-4b-q4` -> `gemma3:4b`).
    /// Fallback a `DEFAULT_COACH_MODEL` si no hay setting o el modelo no existe.
    pub async fn new_from_settings(
        pool: Arc<SidecarPool>,
        app_data_dir: PathBuf,
        db_pool: &sqlx::SqlitePool,
    ) -> Self {
        let coach_model_id: String = sqlx::query_scalar(
            "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
        )
        .fetch_optional(db_pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "gemma3-4b-q4".to_string());

        let builtin_id = crate::coach::llama_engine::map_to_builtin_id(&coach_model_id);
        let model_name = if models::get_model_by_name(builtin_id).is_some() {
            builtin_id.to_string()
        } else {
            log::warn!(
                "Modelo coach '{}' no esta en el registry, usando default '{}'",
                builtin_id,
                DEFAULT_COACH_MODEL
            );
            DEFAULT_COACH_MODEL.to_string()
        };

        log::info!(
            "CoachLlmService inicializado con modelo '{}' (n_ctx={}, tip_max_tokens={})",
            model_name,
            COACH_TIP_CONFIG.n_ctx,
            COACH_TIP_CONFIG.max_tokens
        );

        Self::new(pool, app_data_dir, model_name)
    }

    /// Genera un tip rapido (max_tokens=200, timeout=30s).
    pub async fn generate_tip(
        &self,
        prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        self.generate_internal(prompt, &self.tip_config, cancellation_token)
            .await
    }

    /// Genera evaluacion post-meeting (max_tokens=4096, timeout=120s).
    pub async fn evaluate_meeting(
        &self,
        prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        self.generate_internal(prompt, &self.eval_config, cancellation_token)
            .await
    }

    /// Aplica el template del modelo (Gemma 3 chat template) y genera.
    /// Util para callers que tienen system_prompt + user_prompt separados.
    pub async fn generate_tip_with_template(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        let formatted = self.format_prompt(system_prompt, user_prompt)?;
        self.generate_tip(&formatted, cancellation_token).await
    }

    pub async fn evaluate_meeting_with_template(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        let formatted = self.format_prompt(system_prompt, user_prompt)?;
        self.evaluate_meeting(&formatted, cancellation_token).await
    }

    fn format_prompt(&self, system_prompt: &str, user_prompt: &str) -> Result<String, LlmError> {
        // Resolver el template del modelo (gemma3 por default)
        let template = models::get_model_by_name(&self.model_name)
            .map(|m| m.template)
            .unwrap_or_else(|| "gemma3".to_string());
        models::format_prompt(&template, system_prompt, user_prompt).map_err(LlmError::from)
    }

    async fn generate_internal(
        &self,
        prompt: &str,
        config: &LlmConfig,
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

        // Resolver path del modelo
        let model_path = models::get_model_path(&self.app_data_dir, &self.model_name)
            .map_err(LlmError::from)?;
        if !model_path.exists() {
            self.metrics.record_failure();
            return Err(LlmError::ModelNotFound(format!(
                "Modelo {} no encontrado en {}",
                self.model_name,
                model_path.display()
            )));
        }

        let manager = self
            .pool
            .get_or_spawn(&self.model_name, model_path.clone())
            .await
            .map_err(LlmError::from)?;

        // Cancellation gate post-spawn
        if let Some(token) = cancellation_token {
            if token.is_cancelled() {
                self.metrics.record_cancellation();
                return Err(LlmError::Cancelled);
            }
        }

        let request = GenerationRequest::Generate {
            prompt: prompt.to_string(),
            max_tokens: Some(config.max_tokens as i32),
            context_size: Some(config.n_ctx),
            model_path: Some(model_path.to_string_lossy().to_string()),
            temperature: Some(config.temperature),
            top_k: Some(config.top_k),
            top_p: Some(config.top_p),
            stop_tokens: Some(config.stop_tokens.clone()),
        };
        let request_json = serde_json::to_string(&request)
            .with_context(|| "serializando GenerationRequest")
            .map_err(LlmError::from)?;

        let timeout = Duration::from_secs(config.timeout_secs);
        let started = Instant::now();

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
}

#[async_trait]
impl LlmService for CoachLlmService {
    async fn generate(
        &self,
        prompt: &str,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<String, LlmError> {
        // Default usa tip_config (caso mas comun en el coach).
        self.generate_tip(prompt, cancellation_token).await
    }

    fn model_name(&self) -> &str {
        &self.model_name
    }

    fn config(&self) -> LlmConfig {
        self.tip_config.clone()
    }

    fn metrics(&self) -> &LlmMetrics {
        &self.metrics
    }
}

// ─── Mock para tests ─────────────────────────────────────────────────────────

#[cfg(test)]
pub mod mock {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;

    /// Mock de `LlmService` para tests del coach. Permite configurar respuestas
    /// secuenciales, latencias simuladas, errores, y captura prompts/calls.
    ///
    /// Usa `std::sync::Mutex` (no `tokio::Mutex`) para que los builders
    /// (`responds_with`, etc.) sean `fn(self) -> Self` sin requerir runtime
    /// async — los locks son cortisimos (push/pop a una VecDeque) y no
    /// hay riesgo de bloquear la executor.
    pub struct MockCoachLlmService {
        responses: StdMutex<VecDeque<Result<String, LlmError>>>,
        latency_ms: AtomicU64,
        captured_prompts: StdMutex<Vec<String>>,
        last_config_used: StdMutex<Option<LlmConfig>>,
        call_count: AtomicUsize,
        tip_config: LlmConfig,
        eval_config: LlmConfig,
        metrics: LlmMetrics,
    }

    impl Default for MockCoachLlmService {
        fn default() -> Self {
            Self::new()
        }
    }

    impl MockCoachLlmService {
        pub fn new() -> Self {
            Self {
                responses: StdMutex::new(VecDeque::new()),
                latency_ms: AtomicU64::new(0),
                captured_prompts: StdMutex::new(Vec::new()),
                last_config_used: StdMutex::new(None),
                call_count: AtomicUsize::new(0),
                tip_config: COACH_TIP_CONFIG.to_llm_config(),
                eval_config: COACH_EVAL_CONFIG.to_llm_config(),
                metrics: LlmMetrics::new(),
            }
        }

        pub fn responds_with(self, response: &str) -> Self {
            self.responses.lock().unwrap().push_back(Ok(response.to_string()));
            self
        }

        pub fn responds_with_error(self, error: LlmError) -> Self {
            self.responses.lock().unwrap().push_back(Err(error));
            self
        }

        pub fn responds_with_sequence(self, responses: Vec<Result<String, LlmError>>) -> Self {
            let mut q = self.responses.lock().unwrap();
            for r in responses {
                q.push_back(r);
            }
            drop(q);
            self
        }

        pub fn latency_ms(self, ms: u64) -> Self {
            self.latency_ms.store(ms, Ordering::SeqCst);
            self
        }

        pub fn call_count(&self) -> usize {
            self.call_count.load(Ordering::SeqCst)
        }

        pub fn last_prompt(&self) -> Option<String> {
            self.captured_prompts.lock().unwrap().last().cloned()
        }

        pub fn all_prompts(&self) -> Vec<String> {
            self.captured_prompts.lock().unwrap().clone()
        }

        pub fn last_config(&self) -> Option<LlmConfig> {
            self.last_config_used.lock().unwrap().clone()
        }

        /// Ejecuta `generate_tip` (registra config = tip_config).
        pub async fn generate_tip(
            &self,
            prompt: &str,
            ct: Option<&CancellationToken>,
        ) -> Result<String, LlmError> {
            let cfg = self.tip_config.clone();
            self.execute(prompt, cfg, ct).await
        }

        /// Ejecuta `evaluate_meeting` (registra config = eval_config).
        pub async fn evaluate_meeting(
            &self,
            prompt: &str,
            ct: Option<&CancellationToken>,
        ) -> Result<String, LlmError> {
            let cfg = self.eval_config.clone();
            self.execute(prompt, cfg, ct).await
        }

        async fn execute(
            &self,
            prompt: &str,
            config: LlmConfig,
            ct: Option<&CancellationToken>,
        ) -> Result<String, LlmError> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            self.metrics.record_request();
            self.captured_prompts.lock().unwrap().push(prompt.to_string());
            *self.last_config_used.lock().unwrap() = Some(config);

            let latency = self.latency_ms.load(Ordering::SeqCst);
            if latency > 0 {
                if let Some(token) = ct {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(latency)) => {}
                        _ = token.cancelled() => {
                            self.metrics.record_cancellation();
                            return Err(LlmError::Cancelled);
                        }
                    }
                } else {
                    tokio::time::sleep(Duration::from_millis(latency)).await;
                }
            }

            // Cancellation check post-latencia (caso ct cancelado y latency=0)
            if let Some(token) = ct {
                if token.is_cancelled() {
                    self.metrics.record_cancellation();
                    return Err(LlmError::Cancelled);
                }
            }

            let result = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok("default mock response".to_string()));

            match &result {
                Ok(_) => self.metrics.record_success(latency),
                Err(LlmError::Cancelled) => self.metrics.record_cancellation(),
                Err(_) => self.metrics.record_failure(),
            }
            result
        }
    }

    #[async_trait]
    impl LlmService for MockCoachLlmService {
        async fn generate(
            &self,
            prompt: &str,
            ct: Option<&CancellationToken>,
        ) -> Result<String, LlmError> {
            self.generate_tip(prompt, ct).await
        }

        fn model_name(&self) -> &str {
            "mock-coach"
        }

        fn config(&self) -> LlmConfig {
            self.tip_config.clone()
        }

        fn metrics(&self) -> &LlmMetrics {
            &self.metrics
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::mock::MockCoachLlmService;
    use super::*;
    use std::sync::Arc;
    use std::time::Instant;

    // ─── Tests del Mock (verifican infra de testing) ─────────────────────────

    #[tokio::test]
    async fn mock_records_call_count_correctly() {
        let mock = MockCoachLlmService::new()
            .responds_with("tip 1")
            .responds_with("tip 2")
            .responds_with("tip 3");
        let _ = mock.generate_tip("p1", None).await;
        let _ = mock.generate_tip("p2", None).await;
        let _ = mock.generate_tip("p3", None).await;
        assert_eq!(mock.call_count(), 3);
    }

    #[tokio::test]
    async fn mock_captures_prompts_in_order() {
        let mock = MockCoachLlmService::new()
            .responds_with("a")
            .responds_with("b");
        let _ = mock.generate_tip("first prompt", None).await;
        let _ = mock.generate_tip("second prompt", None).await;
        let prompts = mock.all_prompts();
        assert_eq!(prompts, vec!["first prompt", "second prompt"]);
        assert_eq!(mock.last_prompt(), Some("second prompt".to_string()));
    }

    #[tokio::test]
    async fn mock_responds_with_sequence_fifo() {
        let mock = MockCoachLlmService::new().responds_with_sequence(vec![
            Ok("first".into()),
            Ok("second".into()),
            Err(LlmError::Timeout(30)),
            Ok("fourth".into()),
        ]);
        assert_eq!(mock.generate_tip("p", None).await.unwrap(), "first");
        assert_eq!(mock.generate_tip("p", None).await.unwrap(), "second");
        assert!(matches!(
            mock.generate_tip("p", None).await,
            Err(LlmError::Timeout(30))
        ));
        assert_eq!(mock.generate_tip("p", None).await.unwrap(), "fourth");
    }

    #[tokio::test]
    async fn mock_responds_with_error_returns_correct_error() {
        let mock = MockCoachLlmService::new()
            .responds_with_error(LlmError::ModelNotFound("gemma3:99b".into()));
        let result = mock.generate_tip("any prompt", None).await;
        match result {
            Err(LlmError::ModelNotFound(name)) => assert_eq!(name, "gemma3:99b"),
            other => panic!("Esperaba ModelNotFound, recibi {:?}", other),
        }
    }

    #[tokio::test]
    async fn mock_cancellation_returns_cancelled_error() {
        let mock = Arc::new(
            MockCoachLlmService::new()
                .responds_with("never returned")
                .latency_ms(5000),
        );
        let cancel = CancellationToken::new();
        let mock_clone = Arc::clone(&mock);
        let cancel_clone = cancel.clone();
        let task = tokio::spawn(async move {
            mock_clone
                .generate_tip("slow prompt", Some(&cancel_clone))
                .await
        });
        // Esperar un poco a que arranque el sleep, despues cancelar
        tokio::time::sleep(Duration::from_millis(50)).await;
        let started = Instant::now();
        cancel.cancel();
        let result = task.await.unwrap();
        let elapsed = started.elapsed();
        assert!(matches!(result, Err(LlmError::Cancelled)));
        // Debe haber retornado pronto (no esperado los 5s del latency_ms)
        assert!(
            elapsed < Duration::from_secs(1),
            "Cancelacion tardo demasiado: {:?}",
            elapsed
        );
    }

    #[tokio::test]
    async fn mock_metrics_count_success_failure_cancellation() {
        let mock = MockCoachLlmService::new().responds_with_sequence(vec![
            Ok("ok 1".into()),
            Err(LlmError::Sidecar("crashed".into())),
            Ok("ok 2".into()),
        ]);
        let _ = mock.generate_tip("p1", None).await;
        let _ = mock.generate_tip("p2", None).await;
        let _ = mock.generate_tip("p3", None).await;

        let snap = mock.metrics().snapshot();
        assert_eq!(snap.total_requests, 3);
        assert_eq!(snap.successful_requests, 2);
        assert_eq!(snap.failed_requests, 1);
    }

    // ─── Tests de configs por caso de uso ────────────────────────────────────

    #[tokio::test]
    async fn mock_generate_tip_uses_tip_config_max_tokens_200() {
        let mock = MockCoachLlmService::new().responds_with("ok");
        let _ = mock.generate_tip("prompt", None).await;
        let used = mock.last_config().expect("config registrada");
        assert_eq!(used.max_tokens, 200, "tip debe usar max_tokens=200");
        assert_eq!(used.timeout_secs, 30, "tip debe usar timeout=30s");
        assert_eq!(used.n_ctx, 4096, "REGRESION: tip debe usar n_ctx=4096");
    }

    #[tokio::test]
    async fn mock_evaluate_meeting_uses_eval_config_max_tokens_4096() {
        let mock = MockCoachLlmService::new().responds_with("eval ok");
        let _ = mock.evaluate_meeting("prompt", None).await;
        let used = mock.last_config().expect("config registrada");
        assert_eq!(used.max_tokens, 4096, "eval debe usar max_tokens=4096");
        assert_eq!(used.timeout_secs, 120, "eval debe usar timeout=120s");
        assert_eq!(used.n_ctx, 4096, "REGRESION: eval debe usar n_ctx=4096");
    }

    // ─── Tests de invariantes del servicio real (sin sidecar) ────────────────

    #[test]
    fn coach_tip_config_has_n_ctx_4096_regression() {
        // REGRESION: el bug original tenia n_ctx=32768 hardcodeado en
        // summary_engine/models.rs. Esto reservaba ~640 MB de KV cache en
        // VRAM y rompia con OOM en RTX 3050. Test garantiza que no regresemos.
        let cfg = COACH_TIP_CONFIG.to_llm_config();
        assert_eq!(cfg.n_ctx, 4096, "Bug fix: tip debe usar n_ctx=4096");
        assert_eq!(cfg.max_tokens, 200);
        assert_eq!(cfg.temperature, 0.3);
    }

    #[test]
    fn coach_eval_config_has_n_ctx_4096_regression() {
        let cfg = COACH_EVAL_CONFIG.to_llm_config();
        assert_eq!(cfg.n_ctx, 4096, "Bug fix: eval debe usar n_ctx=4096");
        assert_eq!(cfg.max_tokens, 4096);
        assert_eq!(cfg.temperature, 0.3);
        assert_eq!(cfg.timeout_secs, 120);
    }

    #[test]
    fn coach_default_model_is_gemma3_4b() {
        assert_eq!(DEFAULT_COACH_MODEL, "gemma3:4b");
    }
}
