use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use log::{info, warn, error};
use anyhow::Result;

use crate::state::AppState;
use crate::database::repositories::setting::SettingsRepository;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnboardingStatus {
    pub version: String,
    pub completed: bool,
    pub current_step: u8,
    pub model_status: ModelStatus,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelStatus {
    pub parakeet: String,  // "downloaded" | "not_downloaded" | "downloading"
    pub summary: String,   // §4.1 Solo gemma3:4b (1b retirado del onboarding)
}

impl Default for OnboardingStatus {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            completed: false,
            current_step: 1,
            model_status: ModelStatus {
                parakeet: "not_downloaded".to_string(),
                summary: "not_downloaded".to_string(),  // Changed from gemma
            },
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }
}


/// Load onboarding status from store
pub async fn load_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<OnboardingStatus> {
    // Try to load from Tauri store
    let store = match app.store("onboarding-status.json") {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access onboarding store: {}, using defaults", e);
            return Ok(OnboardingStatus::default());
        }
    };

    // Try to get the status from store
    let mut status = if let Some(value) = store.get("status") {
        match serde_json::from_value::<OnboardingStatus>(value.clone()) {
            Ok(s) => {
                info!("Loaded onboarding status from store - Step: {}, Completed: {}",
                      s.current_step, s.completed);
                s
            }
            Err(e) => {
                warn!("Failed to deserialize onboarding status: {}, using defaults", e);
                OnboardingStatus::default()
            }
        }
    } else {
        info!("No stored onboarding status found, using defaults");
        OnboardingStatus::default()
    };

    // Reconciliar con disco: si los modelos están descargados pero el JSON dice "not_downloaded",
    // corregir el estado. Esto cura ediciones manuales o cambios de ubicación de los archivos.
    let changed = reconcile_model_status_with_disk(app, &mut status);
    if changed {
        info!("✅ Onboarding status reconciled with disk: parakeet={}, summary={}, completed={}",
              status.model_status.parakeet, status.model_status.summary, status.completed);
        // Persistir el estado reconciliado para que la UI lo lea correctamente
        if let Err(e) = save_onboarding_status(app, &status).await {
            warn!("No se pudo persistir el estado reconciliado: {}", e);
        }
    }

    Ok(status)
}

/// Verifica el estado real de los modelos en disco y actualiza `status.model_status`.
/// Devuelve `true` si hubo cambios.
fn reconcile_model_status_with_disk<R: Runtime>(
    app: &AppHandle<R>,
    status: &mut OnboardingStatus,
) -> bool {
    let Ok(base) = app.path().app_data_dir() else {
        return false;
    };
    let mut changed = false;

    // Summary models (Gemma) — buscar en models/summary/
    let summary_dir = base.join("models").join("summary");
    let gemma_1b = summary_dir.join("gemma-3-1b-it-Q8_0.gguf");
    let gemma_4b = summary_dir.join("gemma-3-4b-it-Q4_K_M.gguf");
    let summary_present = is_valid_gguf(&gemma_1b, 800_000_000) || is_valid_gguf(&gemma_4b, 1_800_000_000);

    if summary_present && status.model_status.summary != "downloaded" {
        status.model_status.summary = "downloaded".to_string();
        changed = true;
    }

    // Parakeet — buscar en models/parakeet/
    let parakeet_dir = base.join("models").join("parakeet");
    let parakeet_present = parakeet_dir.exists()
        && parakeet_dir
            .read_dir()
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);

    if parakeet_present && status.model_status.parakeet != "downloaded" {
        status.model_status.parakeet = "downloaded".to_string();
        changed = true;
    }

    // Si todo está descargado, marcar onboarding como completado
    if status.model_status.summary == "downloaded"
        && status.model_status.parakeet == "downloaded"
        && !status.completed
    {
        status.completed = true;
        status.current_step = 4; // último paso
        changed = true;
    }

    changed
}

/// Verifica que un archivo existe y tiene un tamaño mínimo razonable (no es un .tmp incompleto).
fn is_valid_gguf(path: &std::path::Path, min_size: u64) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() >= min_size)
        .unwrap_or(false)
}

/// Save onboarding status to store
pub async fn save_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
    status: &OnboardingStatus,
) -> Result<()> {
    info!("Saving onboarding status: step={}, completed={}",
          status.current_step, status.completed);

    // Get or create store
    let store = app.store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Update last_updated timestamp
    let mut status = status.clone();
    status.last_updated = chrono::Utc::now().to_rfc3339();

    // Serialize status to JSON value
    let status_value = serde_json::to_value(&status)
        .map_err(|e| anyhow::anyhow!("Failed to serialize onboarding status: {}", e))?;

    // Save to store
    store.set("status", status_value);

    // Persist to disk
    store.save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store to disk: {}", e))?;

    info!("Successfully persisted onboarding status to disk");
    Ok(())
}

/// Reset onboarding status (delete from store)
pub async fn reset_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<()> {
    info!("Resetting onboarding status");

    let store = app.store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Clear the status key
    store.delete("status");

    // Persist deletion to disk
    store.save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store after reset: {}", e))?;

    info!("Successfully reset onboarding status");
    Ok(())
}

/// Tauri commands for onboarding status
#[tauri::command]
pub async fn get_onboarding_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<OnboardingStatus>, String> {
    let status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    // Return None if it's the default (never saved before)
    // Check if we have any saved data by seeing if the store has the key
    let store = app.store("onboarding-status.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    if store.get("status").is_none() {
        Ok(None)
    } else {
        Ok(Some(status))
    }
}

#[tauri::command]
pub async fn save_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
    status: OnboardingStatus,
) -> Result<(), String> {
    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save onboarding status: {}", e))
}

#[tauri::command]
pub async fn reset_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    reset_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to reset onboarding status: {}", e))
}

#[tauri::command]
pub async fn complete_onboarding<R: Runtime>(
    app: AppHandle<R>,
    _model: String,
) -> Result<(), String> {
    info!("Completing onboarding with cloud providers (OpenAI + Deepgram)");

    let app_state = app.try_state::<AppState>()
        .ok_or_else(|| "La base de datos no está lista. Espera un momento y vuelve a intentarlo.".to_string())?;
    let pool = app_state.db_manager.pool();

    // Use OpenAI for summaries (cloud API)
    if let Err(e) = SettingsRepository::save_model_config(
        pool,
        "openai",
        "gpt-4o-2024-11-20",
        "deepgram",  // Whisper model field repurposed - not used with cloud
        None,
    ).await {
        error!("Failed to save OpenAI model config: {}", e);
        return Err(format!("Failed to save OpenAI model config: {}", e));
    }
    info!("Saved summary model config: provider=openai, model=gpt-4o-2024-11-20");

    // Save transcription config - use Parakeet (local) with int8 model and Spanish
    if let Err(e) = SettingsRepository::save_transcript_config(
        pool,
        "parakeet",
        "parakeet-tdt-0.6b-v3-int8",
        Some("es-419"),
    ).await {
        error!("Failed to save transcription model config: {}", e);
        return Err(format!("Failed to save transcription model config: {}", e));
    }
    info!("Saved transcription model config: provider=parakeet, model=parakeet-tdt-0.6b-v3-int8, language=es-419");

    // Step 2: Only NOW mark onboarding as complete (after DB operations succeed)
    let mut status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    status.completed = true;
    status.current_step = 4; // Max step (4 on macOS with permissions, 3 on other platforms)
    // Local mode - mark parakeet as pending_download for auto-download at startup
    status.model_status.parakeet = "pending_download".to_string();
    status.model_status.summary = "cloud".to_string();

    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save completed onboarding status: {}", e))?;

    info!("Onboarding completed successfully with local Parakeet provider");
    Ok(())
}
