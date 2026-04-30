// High-level client API for built-in AI summary generation
// Provides simple interface for generating text using the sidecar pool

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::models;
use crate::llm::transport::SidecarPool;

// ============================================================================
// Request/Response Types (en este modulo por compat — los del modulo `llm/`
// son equivalentes pero los servicios nuevos los usan directamente)
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Generate {
        prompt: String,
        max_tokens: Option<i32>,
        context_size: Option<u32>,
        model_path: Option<String>,
        // Sampling parameters
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        stop_tokens: Option<Vec<String>>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Response {
    Response { text: String, error: Option<String> },
    Error { message: String },
}

// ============================================================================
// Global Sidecar Pool
// ============================================================================

/// Pool global de sidecars indexados por nombre de modelo. Reemplaza al antiguo
/// `SIDECAR_MANAGER` singleton. Permite que coach (ej. Gemma 1B) y summary
/// (ej. Gemma 4B) tengan procesos llama-helper independientes en paralelo, sin
/// que cambiar de modelo en uno desaloje al otro.
///
/// Se inicializa en el primer `init_sidecar_manager(app_data_dir)` o en el
/// primer `generate_with_builtin(...)` (lazy si nadie llamo init).
pub static SIDECAR_POOL: Lazy<Arc<Mutex<Option<Arc<SidecarPool>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

// Model path cache to avoid repeated filesystem I/O and model lookups
static MODEL_PATH_CACHE: Lazy<RwLock<HashMap<String, PathBuf>>> = Lazy::new(|| {
    RwLock::new(HashMap::new())
});

/// Initialize the global sidecar pool with the app data directory.
///
/// Idempotente: si ya esta inicializado con el mismo `app_data_dir`, no hace
/// nada. Si el directorio cambio (caso raro de reinit), reemplaza el pool y
/// los sidecars del pool anterior se apagan al ser dropeados.
pub async fn init_sidecar_manager(app_data_dir: PathBuf) -> Result<()> {
    let mut global = SIDECAR_POOL.lock().await;
    if global.is_none() {
        log::info!(
            "Inicializando SidecarPool con app_data_dir={}",
            app_data_dir.display()
        );
        *global = Some(Arc::new(SidecarPool::new(app_data_dir)));
    }
    Ok(())
}

/// Get the global sidecar pool, initializing it lazily if needed.
pub async fn get_sidecar_pool(app_data_dir: &PathBuf) -> Result<Arc<SidecarPool>> {
    let mut global = SIDECAR_POOL.lock().await;
    if global.is_none() {
        log::info!(
            "Lazy-init SidecarPool con app_data_dir={}",
            app_data_dir.display()
        );
        *global = Some(Arc::new(SidecarPool::new(app_data_dir.clone())));
    }
    Ok(global.clone().unwrap())
}

/// Get cached model path with read-through caching to avoid repeated filesystem I/O
fn get_cached_model_path(app_data_dir: &PathBuf, model_name: &str) -> Result<PathBuf> {
    // Try read lock first (fast path for cache hits)
    {
        let cache = MODEL_PATH_CACHE.read().unwrap();
        if let Some(path) = cache.get(model_name) {
            // Verify file still exists before returning cached path
            if path.exists() {
                return Ok(path.clone());
            }
        }
    }

    // Cache miss or file deleted - acquire write lock and update cache
    let mut cache = MODEL_PATH_CACHE.write().unwrap();

    // Double-check after acquiring write lock (another thread may have updated it)
    if let Some(path) = cache.get(model_name) {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Resolve model path (involves model lookup + filesystem operations)
    let model_path = models::get_model_path(app_data_dir, model_name)?;

    if !model_path.exists() {
        return Err(anyhow!(
            "Model file not found: {}. Please download the model '{}' first.",
            model_path.display(),
            model_name
        ));
    }

    // Cache the validated path
    cache.insert(model_name.to_string(), model_path.clone());
    Ok(model_path)
}

// ============================================================================
// Public API
// ============================================================================

/// Generate text using built-in AI
///
/// # Arguments
/// * `app_data_dir` - Application data directory (for model resolution)
/// * `model_name` - Model name (e.g., "gemma3:1b")
/// * `system_prompt` - System instructions for the model
/// * `user_prompt` - User message/task
/// * `cancellation_token` - Optional token for cancellation
///
/// # Returns
/// Generated text
pub async fn generate_with_builtin(
    app_data_dir: &PathBuf,
    model_name: &str,
    system_prompt: &str,
    user_prompt: &str,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String> {
    // Check cancellation at start
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled before starting"));
        }
    }

    log::info!("Built-in AI generation request");
    log::info!("Model: {}", model_name);

    // Get model definition
    let model_def = models::get_model_by_name(model_name)
        .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

    // Resolve model path with caching (avoids repeated filesystem I/O)
    let model_path = get_cached_model_path(app_data_dir, model_name)?;

    // Apply model-specific chat template
    let formatted_prompt =
        models::format_prompt(&model_def.template, system_prompt, user_prompt)?;

    // Get sidecar via pool (spawns if needed; reuses if model already loaded)
    let pool = get_sidecar_pool(app_data_dir).await?;
    let manager = pool.get_or_spawn(model_name, model_path.clone()).await?;

    // Check cancellation after sidecar startup
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled during sidecar startup"));
        }
    }

    // Prepare generation request with model-specific sampling parameters
    let request = Request::Generate {
        prompt: formatted_prompt,
        max_tokens: Some(models::DEFAULT_MAX_TOKENS),
        context_size: Some(model_def.context_size),
        model_path: Some(model_path.to_string_lossy().to_string()),
        temperature: Some(model_def.sampling.temperature),
        top_k: Some(model_def.sampling.top_k),
        top_p: Some(model_def.sampling.top_p),
        stop_tokens: Some(model_def.sampling.stop_tokens.clone()),
    };

    let request_json = serde_json::to_string(&request)?;

    // Send request with timeout
    let timeout = Duration::from_secs(models::GENERATION_TIMEOUT_SECS);

    log::info!("Sending generation request to sidecar (model={})", model_name);

    // Race between send_request and cancellation token
    let response_json = if let Some(token) = cancellation_token {
        tokio::select! {
            result = manager.send_request(request_json, timeout) => {
                result?
            }
            _ = token.cancelled() => {
                log::warn!("Generation cancelled by user, shutting down sidecar");
                // Shutdown sidecar to stop generation immediately
                if let Err(e) = manager.shutdown().await {
                    log::error!("Failed to shutdown sidecar during cancellation: {}", e);
                }
                return Err(anyhow!("Generation cancelled by user"));
            }
        }
    } else {
        manager.send_request(request_json, timeout).await?
    };

    // Check cancellation before parsing response
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err(anyhow!("Generation cancelled"));
        }
    }

    // Parse response
    let response: Response = serde_json::from_str(&response_json)
        .with_context(|| format!("Failed to parse response: {}", response_json))?;

    match response {
        Response::Response { text, error } => {
            if let Some(err_msg) = error {
                Err(anyhow!("Generation failed: {}", err_msg))
            } else {
                log::info!("Generation completed: {} chars", text.len());
                Ok(text)
            }
        }
        Response::Error { message } => Err(anyhow!("Sidecar error: {}", message)),
    }
}

/// Shutdown all sidecars gracefully (waits for active requests to complete).
/// Useful for app exit or coordinated shutdown.
pub async fn shutdown_sidecar_gracefully() -> Result<()> {
    let pool_opt = {
        let mut global = SIDECAR_POOL.lock().await;
        global.take()
    };

    if let Some(pool) = pool_opt {
        log::info!("SidecarPool: graceful shutdown de todos los sidecars");
        // Spawn background task para no bloquear la llamada
        tokio::spawn(async move {
            if let Err(e) = pool.shutdown_all().await {
                log::error!("Error en graceful shutdown del pool: {}", e);
            }
        });
    }

    Ok(())
}

/// Force shutdown all sidecars (for app exit).
/// Synchronous: blocks until all sidecars are terminated.
pub async fn force_shutdown_sidecar() -> Result<()> {
    let pool_opt = {
        let mut global = SIDECAR_POOL.lock().await;
        global.take()
    };

    if let Some(pool) = pool_opt {
        log::info!("SidecarPool: force shutdown de todos los sidecars (app exit)");
        pool.shutdown_all().await?;
    }

    Ok(())
}

/// Check if at least one sidecar is healthy. True si hay alguno con `is_healthy()=true`.
pub async fn is_sidecar_healthy() -> bool {
    let global = SIDECAR_POOL.lock().await;
    if let Some(pool) = global.as_ref() {
        let map = pool.sidecars_for_health_check().await;
        map.into_iter().any(|m| m.is_healthy())
    } else {
        false
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_serialization() {
        let request = Request::Generate {
            prompt: "test prompt".to_string(),
            max_tokens: Some(512),
            context_size: Some(2048),
            model_path: Some("/path/to/model.gguf".to_string()),
            temperature: Some(1.0),
            top_k: Some(64),
            top_p: Some(0.95),
            stop_tokens: Some(vec!["<end_of_turn>".to_string()]),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"type\":\"generate\""));
        assert!(json.contains("\"prompt\":\"test prompt\""));
        assert!(json.contains("\"max_tokens\":512"));
        assert!(json.contains("\"temperature\":1.0"));
    }

    #[test]
    fn test_response_deserialization() {
        let json = r#"{"type":"response","text":"generated text","error":null}"#;
        let response: Response = serde_json::from_str(json).unwrap();

        match response {
            Response::Response { text, error } => {
                assert_eq!(text, "generated text");
                assert!(error.is_none());
            }
            _ => panic!("Wrong response type"),
        }
    }

    #[test]
    fn test_error_response_deserialization() {
        let json = r#"{"type":"error","message":"something went wrong"}"#;
        let response: Response = serde_json::from_str(json).unwrap();

        match response {
            Response::Error { message } => {
                assert_eq!(message, "something went wrong");
            }
            _ => panic!("Wrong response type"),
        }
    }
}
