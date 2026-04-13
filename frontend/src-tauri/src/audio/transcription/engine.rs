// audio/transcription/engine.rs
//
// TranscriptionEngine enum and model initialization/validation logic.

use super::provider::TranscriptionProvider;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

// ============================================================================
// TRANSCRIPTION ENGINE ENUM
// ============================================================================

// Transcription engine abstraction to support multiple providers
pub enum TranscriptionEngine {
    Parakeet(Arc<crate::parakeet_engine::ParakeetEngine>),
    Canary(Arc<crate::canary_engine::CanaryEngine>),
    Provider(Arc<dyn TranscriptionProvider>),
}

impl TranscriptionEngine {
    /// Check if the engine has a model loaded
    pub async fn is_model_loaded(&self) -> bool {
        match self {
            Self::Parakeet(engine) => engine.is_model_loaded().await,
            Self::Canary(engine) => engine.is_model_loaded().await,
            Self::Provider(provider) => provider.is_model_loaded().await,
        }
    }

    /// Get the current model name
    pub async fn get_current_model(&self) -> Option<String> {
        match self {
            Self::Parakeet(engine) => engine.get_current_model().await,
            Self::Canary(engine) => engine.get_current_model().await,
            Self::Provider(provider) => provider.get_current_model().await,
        }
    }

    /// Get the provider name for logging
    pub fn provider_name(&self) -> &str {
        match self {
            Self::Parakeet(_) => "Parakeet (direct)",
            Self::Canary(_) => "Canary (direct)",
            Self::Provider(provider) => provider.provider_name(),
        }
    }
}

// ============================================================================
// MODEL VALIDATION AND INITIALIZATION
// ============================================================================

/// Validate that transcription models are ready before starting recording
pub async fn validate_transcription_model_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // FAST PATH: Check if any engine already has a model loaded (zero DB/filesystem I/O)
    // Clone Arc out of MutexGuard before await to satisfy Send requirement
    let parakeet_engine = crate::parakeet_engine::commands::PARAKEET_ENGINE
        .lock().ok().and_then(|guard| guard.as_ref().cloned());
    if let Some(engine) = parakeet_engine {
        if engine.is_model_loaded().await {
            info!("FAST: Parakeet model ready (pre-loaded)");
            return Ok(());
        }
    }
    let canary_engine = crate::canary_engine::commands::CANARY_ENGINE
        .lock().ok().and_then(|guard| guard.as_ref().cloned());
    if let Some(engine) = canary_engine {
        if engine.is_model_loaded().await {
            info!("FAST: Canary model ready (pre-loaded)");
            return Ok(());
        }
    }

    // SLOW PATH: No engine has a model loaded (startup pre-load failed or first launch)
    warn!("No transcription model pre-loaded, running full validation...");

    // Check transcript configuration to determine which engine to validate
    let config = match crate::api::api::api_get_transcript_config(
        app.clone(),
        app.clone().state(),
        None,
    )
    .await
    {
        Ok(Some(config)) => {
            info!(
                "📝 Found transcript config - provider: {}, model: {}",
                config.provider, config.model
            );
            config
        }
        Ok(None) => {
            info!("📝 No transcript config found, defaulting to parakeet");
            crate::api::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
            }
        }
        Err(e) => {
            warn!("⚠️ Failed to get transcript config: {}, defaulting to parakeet", e);
            crate::api::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
            }
        }
    };

    // Validate based on provider
    match config.provider.as_str() {
        "parakeet" => {
            info!("🔍 Validating Parakeet model...");
            // Ensure parakeet engine is initialized first
            if let Err(init_error) = crate::parakeet_engine::commands::parakeet_init().await {
                warn!("❌ Failed to initialize Parakeet engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Parakeet speech recognition: {}",
                    init_error
                ));
            }

            // Use the validation command that includes auto-discovery and loading
            // This matches the Whisper behavior for consistency
            match crate::parakeet_engine::commands::parakeet_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Parakeet model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Parakeet model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        "canary" => {
            info!("🐦 Validating Canary model...");
            if let Err(init_error) = crate::canary_engine::commands::canary_init().await {
                warn!("❌ Failed to initialize Canary engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Canary speech recognition: {}",
                    init_error
                ));
            }

            match crate::canary_engine::commands::canary_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Canary model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Canary model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        other => {
            warn!("❌ Unsupported transcription provider: '{}', falling back to parakeet", other);
            // Fallback to Parakeet for any unknown provider
            info!("🔍 Validating Parakeet model (fallback from '{}')...", other);
            if let Err(init_error) = crate::parakeet_engine::commands::parakeet_init().await {
                warn!("❌ Failed to initialize Parakeet engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Parakeet speech recognition: {}",
                    init_error
                ));
            }
            match crate::parakeet_engine::commands::parakeet_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Parakeet model validation successful (fallback): {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Parakeet model validation failed: {}", e);
                    Err(e)
                }
            }
        }
    }
}

/// Get or initialize the appropriate transcription engine based on provider configuration
pub async fn get_or_init_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TranscriptionEngine, String> {
    // Get provider configuration from API
    let config = match crate::api::api::api_get_transcript_config(
        app.clone(),
        app.clone().state(),
        None,
    )
    .await
    {
        Ok(Some(config)) => {
            info!(
                "📝 Transcript config - provider: {}, model: {}",
                config.provider, config.model
            );
            config
        }
        Ok(None) => {
            info!("📝 No transcript config found, defaulting to parakeet");
            crate::api::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
            }
        }
        Err(e) => {
            warn!("⚠️ Failed to get transcript config: {}, defaulting to parakeet", e);
            crate::api::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
            }
        }
    };

    // Initialize transcription engine based on provider
    if config.provider == "canary" {
        info!("🐦 Initializing Canary transcription engine");

        let engine = {
            let guard = crate::canary_engine::commands::CANARY_ENGINE
                .lock()
                .map_err(|e| format!("Canary engine mutex poisoned: {}", e))?;
            guard.as_ref().cloned()
        };

        return match engine {
            Some(engine) => {
                if engine.is_model_loaded().await {
                    let model_name = engine.get_current_model().await
                        .unwrap_or_else(|| "unknown".to_string());
                    info!("✅ Canary model '{}' already loaded", model_name);
                    Ok(TranscriptionEngine::Canary(engine))
                } else {
                    Err("Canary engine initialized but no model loaded.".to_string())
                }
            }
            None => {
                Err("Canary engine not initialized.".to_string())
            }
        };
    }

    info!("🦜 Initializing Parakeet transcription engine");

    // Get Parakeet engine
    let engine = {
        let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
            .lock()
            .map_err(|e| format!("Parakeet engine mutex poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    match engine {
        Some(engine) => {
            // Check if model is loaded
            if engine.is_model_loaded().await {
                let model_name = engine.get_current_model().await
                    .unwrap_or_else(|| "unknown".to_string());
                info!("✅ Parakeet model '{}' already loaded", model_name);
                Ok(TranscriptionEngine::Parakeet(engine))
            } else {
                Err("Parakeet engine initialized but no model loaded. This should not happen after validation.".to_string())
            }
        }
        None => {
            Err("Parakeet engine not initialized. This should not happen after validation.".to_string())
        }
    }
}


