use crate::canary_engine::{CanaryEngine, DownloadProgress, ModelInfo, ModelStatus};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Manager, Runtime};

// Global canary engine
pub static CANARY_ENGINE: Mutex<Option<Arc<CanaryEngine>>> = Mutex::new(None);

// Global models directory path
static MODELS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Initialize the models directory path using app_data_dir
pub fn set_models_directory<R: Runtime>(app: &AppHandle<R>) {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");

    let models_dir = app_data_dir.join("models");

    if !models_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&models_dir) {
            log::error!("Failed to create Canary models directory: {}", e);
            return;
        }
    }

    log::info!(
        "Canary models directory set to: {}",
        models_dir.display()
    );

    let mut guard = MODELS_DIR.lock().unwrap_or_else(|e| { log::error!("Lock poisoned: {}", e); e.into_inner() });
    *guard = Some(models_dir);
}

fn get_models_directory() -> Option<PathBuf> {
    MODELS_DIR.lock().unwrap_or_else(|e| { log::error!("Lock poisoned: {}", e); e.into_inner() }).clone()
}

#[command]
pub async fn canary_init() -> Result<(), String> {
    let mut guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    if guard.is_some() {
        return Ok(());
    }

    let models_dir = get_models_directory();
    let engine = CanaryEngine::new_with_models_dir(models_dir)
        .map_err(|e| format!("Failed to initialize Canary engine: {}", e))?;
    *guard = Some(Arc::new(engine));
    Ok(())
}

#[command]
pub async fn canary_get_available_models() -> Result<Vec<ModelInfo>, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover Canary models: {}", e))
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_load_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        let _ = app_handle.emit(
            "canary-model-loading-started",
            serde_json::json!({ "modelName": model_name }),
        );

        let result = engine
            .load_model(&model_name)
            .await
            .map_err(|e| format!("Failed to load Canary model: {}", e));

        if result.is_ok() {
            let _ = app_handle.emit(
                "canary-model-loading-completed",
                serde_json::json!({ "modelName": model_name }),
            );
        } else if let Err(ref error) = result {
            let _ = app_handle.emit(
                "canary-model-loading-failed",
                serde_json::json!({ "modelName": model_name, "error": error }),
            );
        }

        result
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_get_current_model() -> Result<Option<String>, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        Ok(engine.get_current_model().await)
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_is_model_loaded() -> Result<bool, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        Ok(engine.is_model_loaded().await)
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_unload_model() -> Result<bool, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        Ok(engine.unload_model().await)
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_validate_model_ready() -> Result<String, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        if engine.is_model_loaded().await {
            if let Some(current_model) = engine.get_current_model().await {
                return Ok(current_model);
            }
        }

        let models = engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover Canary models: {}", e))?;

        let available_models: Vec<_> = models
            .iter()
            .filter(|model| matches!(model.status, ModelStatus::Available))
            .collect();

        if available_models.is_empty() {
            return Err(
                "No Canary models available. Please download a model first.".to_string(),
            );
        }

        let first_model = available_models.first().unwrap();
        engine
            .load_model(&first_model.name)
            .await
            .map_err(|e| format!("Failed to load Canary model {}: {}", first_model.name, e))?;

        Ok(first_model.name.clone())
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

/// Internal validation with config awareness
pub async fn canary_validate_model_ready_with_config<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<String, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        if engine.is_model_loaded().await {
            if let Some(current_model) = engine.get_current_model().await {
                log::info!("Canary model already loaded: {}", current_model);
                return Ok(current_model);
            }
        }

        // Check user's configured model
        let model_to_load = match crate::api::api::api_get_transcript_config(
            app.clone(),
            app.state(),
            None,
        )
        .await
        {
            Ok(Some(config)) if config.provider == "canary" && !config.model.is_empty() => {
                log::info!("Using configured Canary model: {}", config.model);
                Some(config.model)
            }
            _ => None,
        };

        let models = engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover Canary models: {}", e))?;

        let available_models: Vec<_> = models
            .iter()
            .filter(|model| matches!(model.status, ModelStatus::Available))
            .collect();

        if available_models.is_empty() {
            return Err(
                "No Canary models available. Please download a model first.".to_string(),
            );
        }

        let model_name = if let Some(configured) = model_to_load {
            if available_models.iter().any(|m| m.name == configured) {
                configured
            } else {
                log::warn!("Configured Canary model '{}' not found, using first available", configured);
                available_models.first().unwrap().name.clone()
            }
        } else {
            available_models.first().unwrap().name.clone()
        };

        engine
            .load_model(&model_name)
            .await
            .map_err(|e| format!("Failed to load Canary model {}: {}", model_name, e))?;

        Ok(model_name)
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_transcribe_audio(audio_data: Vec<f32>) -> Result<String, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .transcribe_audio(audio_data)
            .await
            .map_err(|e| format!("Canary transcription failed: {}", e))
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_download_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        let app_handle_clone = app_handle.clone();
        let model_name_clone = model_name.clone();

        let progress_callback = Box::new(move |progress: DownloadProgress| {
            log::info!(
                "Canary download: {} - {:.1}/{:.1} MB ({:.1} MB/s) {}%",
                model_name_clone,
                progress.downloaded_mb,
                progress.total_mb,
                progress.speed_mbps,
                progress.percent
            );

            let _ = app_handle_clone.emit(
                "canary-model-download-progress",
                serde_json::json!({
                    "modelName": model_name_clone,
                    "progress": progress.percent,
                    "downloaded_bytes": progress.downloaded_bytes,
                    "total_bytes": progress.total_bytes,
                    "downloaded_mb": progress.downloaded_mb,
                    "total_mb": progress.total_mb,
                    "speed_mbps": progress.speed_mbps,
                    "status": if progress.percent == 100 { "completed" } else { "downloading" }
                }),
            );
        });

        // Ensure models are discovered
        if let Err(e) = engine.discover_models().await {
            log::warn!("Failed to discover Canary models before download: {}", e);
        }

        let result = engine
            .download_model_detailed(&model_name, Some(progress_callback))
            .await;

        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "canary-model-download-complete",
                    serde_json::json!({ "modelName": model_name }),
                );
                crate::tray::update_tray_menu(&app_handle);
                Ok(())
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "canary-model-download-error",
                    serde_json::json!({
                        "modelName": model_name,
                        "error": e.to_string()
                    }),
                );
                Err(format!("Failed to download Canary model: {}", e))
            }
        }
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_cancel_download<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .cancel_download(&model_name)
            .await
            .map_err(|e| format!("Failed to cancel Canary download: {}", e))?;

        let _ = app_handle.emit(
            "canary-model-download-progress",
            serde_json::json!({
                "modelName": model_name,
                "progress": 0,
                "status": "cancelled"
            }),
        );

        Ok(())
    } else {
        Err("Canary engine not initialized".to_string())
    }
}

#[command]
pub async fn canary_delete_model(model_name: String) -> Result<String, String> {
    let engine = {
        let guard = CANARY_ENGINE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .delete_model(&model_name)
            .await
            .map_err(|e| format!("Failed to delete Canary model: {}", e))
    } else {
        Err("Canary engine not initialized".to_string())
    }
}
