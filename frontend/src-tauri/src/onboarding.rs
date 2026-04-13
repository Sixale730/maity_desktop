use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
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
    pub summary: String,   // Generic field for summary model (gemma3:1b or gemma3:4b)
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
    let status = if let Some(value) = store.get("status") {
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

    Ok(status)
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
    state: tauri::State<'_, AppState>,
    _model: String,
) -> Result<(), String> {
    // Local-first mode: Use local Parakeet for transcription
    info!("Completing onboarding with local Parakeet transcription");

    // Step 1: Save model configuration to SQLite database FIRST
    let pool = state.db_manager.pool();

    // Use Ollama local (gemma4) para summaries — privacidad first, sin cloud,
    // sin API keys. Cambiado de OpenAI gpt-4o-2024-11-20 (2026-04-11) por
    // requisito explícito del usuario: la app NO debe llamar a APIs externas.
    if let Err(e) = SettingsRepository::save_model_config(
        pool,
        "ollama",
        "gemma4:latest",
        "small",  // Whisper model for summary model config (not actively used)
        None,
    ).await {
        error!("Failed to save Ollama model config: {}", e);
        return Err(format!("Failed to save Ollama model config: {}", e));
    }
    info!("Saved summary model config: provider=ollama, model=gemma4:latest");

    // Save transcription config - use Parakeet (privacy-first, optimized for CPU)
    if let Err(e) = SettingsRepository::save_transcript_config(
        pool,
        "parakeet",
        "parakeet-tdt-0.6b-v3-int8",
    ).await {
        error!("Failed to save transcription model config: {}", e);
        return Err(format!("Failed to save transcription model config: {}", e));
    }
    info!("Saved transcription model config: provider=parakeet, model=parakeet-tdt-0.6b-v3-int8");

    // Step 2: Only NOW mark onboarding as complete (after DB operations succeed)
    let mut status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    status.completed = true;
    status.current_step = 4; // Max step (4 on macOS with permissions, 3 on other platforms)
    // Local mode - mark model status
    status.model_status.parakeet = "not_downloaded".to_string();
    status.model_status.summary = "cloud".to_string();

    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save completed onboarding status: {}", e))?;

    info!("Onboarding completed successfully with Parakeet transcription");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_onboarding_status_default_values() {
        // Arrange, Act
        let status = OnboardingStatus::default();

        // Assert
        assert_eq!(status.version, "1.0");
        assert!(!status.completed);
        assert_eq!(status.current_step, 1);
        assert_eq!(status.model_status.parakeet, "not_downloaded");
        assert_eq!(status.model_status.summary, "not_downloaded");
    }

    #[test]
    fn test_onboarding_status_serialization() {
        // Arrange
        let original = OnboardingStatus {
            version: "1.0".to_string(),
            completed: true,
            current_step: 3,
            model_status: ModelStatus {
                parakeet: "downloaded".to_string(),
                summary: "downloading".to_string(),
            },
            last_updated: "2026-04-12T10:30:00Z".to_string(),
        };

        // Act
        let json = serde_json::to_string(&original).expect("Serialization failed");
        let deserialized: OnboardingStatus =
            serde_json::from_str(&json).expect("Deserialization failed");

        // Assert
        assert_eq!(deserialized.version, original.version);
        assert_eq!(deserialized.completed, original.completed);
        assert_eq!(deserialized.current_step, original.current_step);
        assert_eq!(
            deserialized.model_status.parakeet,
            original.model_status.parakeet
        );
        assert_eq!(
            deserialized.model_status.summary,
            original.model_status.summary
        );
        assert_eq!(deserialized.last_updated, original.last_updated);
    }

    #[test]
    fn test_onboarding_status_clone() {
        // Arrange
        let original = OnboardingStatus {
            version: "1.0".to_string(),
            completed: false,
            current_step: 2,
            model_status: ModelStatus {
                parakeet: "downloading".to_string(),
                summary: "not_downloaded".to_string(),
            },
            last_updated: "2026-04-12T10:30:00Z".to_string(),
        };

        // Act
        let cloned = original.clone();

        // Assert
        assert_eq!(cloned.version, original.version);
        assert_eq!(cloned.completed, original.completed);
        assert_eq!(cloned.current_step, original.current_step);
        assert_eq!(cloned.model_status.parakeet, original.model_status.parakeet);
    }

    #[test]
    fn test_model_status_default_values() {
        // Arrange, Act
        let model_status = ModelStatus::default();

        // Assert
        assert_eq!(model_status.parakeet, "");
        assert_eq!(model_status.summary, "");
    }

    #[test]
    fn test_onboarding_status_state_transitions() {
        // Arrange
        let mut status = OnboardingStatus::default();
        assert_eq!(status.current_step, 1);
        assert!(!status.completed);

        // Act: Progress through steps
        status.current_step = 2;
        status.model_status.parakeet = "downloading".to_string();

        // Assert
        assert_eq!(status.current_step, 2);
        assert_eq!(status.model_status.parakeet, "downloading");
        assert!(!status.completed);

        // Act: Complete onboarding
        status.current_step = 4;
        status.completed = true;
        status.model_status.parakeet = "downloaded".to_string();

        // Assert
        assert_eq!(status.current_step, 4);
        assert!(status.completed);
        assert_eq!(status.model_status.parakeet, "downloaded");
    }

    #[test]
    fn test_onboarding_status_roundtrip_json_with_models() {
        // Arrange: Simulate a completed onboarding state
        let original = OnboardingStatus {
            version: "1.0".to_string(),
            completed: true,
            current_step: 4,
            model_status: ModelStatus {
                parakeet: "downloaded".to_string(),
                summary: "cloud".to_string(),
            },
            last_updated: "2026-04-12T12:00:00Z".to_string(),
        };

        // Act: Serialize to JSON value (as done in save_onboarding_status)
        let json_value = serde_json::to_value(&original)
            .expect("Serialization to JSON value failed");

        // Assert JSON structure
        assert!(json_value.is_object());
        assert_eq!(json_value["version"].as_str(), Some("1.0"));
        assert_eq!(json_value["completed"].as_bool(), Some(true));
        assert_eq!(json_value["current_step"].as_u64(), Some(4));
        assert_eq!(
            json_value["model_status"]["parakeet"].as_str(),
            Some("downloaded")
        );
        assert_eq!(
            json_value["model_status"]["summary"].as_str(),
            Some("cloud")
        );

        // Act: Deserialize back
        let deserialized: OnboardingStatus =
            serde_json::from_value(json_value).expect("Deserialization from JSON value failed");

        // Assert round-trip equality
        assert_eq!(deserialized.version, original.version);
        assert_eq!(deserialized.completed, original.completed);
        assert_eq!(deserialized.current_step, original.current_step);
        assert_eq!(
            deserialized.model_status.parakeet,
            original.model_status.parakeet
        );
    }
}
