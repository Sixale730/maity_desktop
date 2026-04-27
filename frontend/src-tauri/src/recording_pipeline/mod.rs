pub mod config;
pub mod registry;

pub use config::{LiveFeedbackConfig, RecordingPipeline, SttConfig};

use crate::state::AppState;
use log::info;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn get_available_pipelines() -> Vec<RecordingPipeline> {
    registry::get_default_pipelines()
}

#[tauri::command]
pub async fn get_active_pipeline_id<R: Runtime>(app: AppHandle<R>) -> String {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    sqlx::query_scalar::<_, String>(
        "SELECT active_pipeline_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "local_parakeet_gemma".to_string())
}

#[tauri::command]
pub async fn set_active_pipeline<R: Runtime>(
    app: AppHandle<R>,
    pipeline_id: String,
) -> Result<(), String> {
    let pipelines = registry::get_default_pipelines();
    let pipeline = pipelines
        .iter()
        .find(|p| p.id == pipeline_id)
        .ok_or_else(|| format!("Pipeline '{}' not found", pipeline_id))?;

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    sqlx::query(
        "INSERT INTO coach_settings (id, active_pipeline_id) VALUES ('1', ?)
         ON CONFLICT(id) DO UPDATE SET active_pipeline_id = excluded.active_pipeline_id",
    )
    .bind(&pipeline_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save active pipeline: {}", e))?;

    // Sync STT settings so the existing engine init picks it up automatically
    let (provider, model) = match &pipeline.stt {
        SttConfig::Parakeet => ("parakeet", "parakeet-tdt-0.6b"),
        SttConfig::Moonshine => ("moonshine", "moonshine"),
        SttConfig::Whisper { model } => ("whisper", model.as_str()),
        SttConfig::Deepgram { .. } => ("deepgram", "nova-3"),
    };

    sqlx::query(
        "INSERT INTO transcript_settings (id, provider, model, language)
         VALUES ('1', ?, ?, 'es-419')
         ON CONFLICT(id) DO UPDATE SET
             provider = excluded.provider,
             model = excluded.model",
    )
    .bind(provider)
    .bind(model)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to update STT settings: {}", e))?;

    info!("✅ Pipeline set to '{}' (STT: {})", pipeline_id, provider);
    Ok(())
}

#[tauri::command]
pub async fn get_pipeline_config(pipeline_id: String) -> Result<RecordingPipeline, String> {
    registry::get_default_pipelines()
        .into_iter()
        .find(|p| p.id == pipeline_id)
        .ok_or_else(|| format!("Pipeline '{}' not found", pipeline_id))
}

/// Returns the LiveFeedbackConfig for the currently active pipeline, if it has one.
pub async fn get_active_live_feedback_config<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<LiveFeedbackConfig> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let pipeline_id = sqlx::query_scalar::<_, String>(
        "SELECT active_pipeline_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "local_parakeet_gemma".to_string());

    registry::get_default_pipelines()
        .into_iter()
        .find(|p| p.id == pipeline_id)
        .and_then(|p| p.live_feedback)
}
