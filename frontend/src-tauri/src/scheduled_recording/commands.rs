//! Comandos Tauri de la grabación programada por jornada.
//!
//! Espejo 1:1 del set del Meeting Detector (`meeting_detector/commands.rs`).

use std::sync::Arc;

use log::info;
use tauri::{AppHandle, Runtime, State, Wry};
use tokio::sync::RwLock;

use super::service::{ScheduledRecordingService, ScheduledStatus};
use super::settings::ScheduledRecordingSettings;

/// Estado compartido del servicio de grabación programada.
pub type ScheduledRecordingState = Arc<RwLock<ScheduledRecordingService>>;

/// Inicializa el servicio (llamado durante el setup de la app).
pub async fn initialize_scheduled_recording<R: Runtime>(
    app_handle: AppHandle<R>,
) -> anyhow::Result<ScheduledRecordingService> {
    info!("Initializing scheduled recording service...");
    let mut service = ScheduledRecordingService::new();
    service.initialize(&app_handle).await?;
    Ok(service)
}

#[tauri::command]
pub async fn get_scheduled_recording_settings(
    state: State<'_, ScheduledRecordingState>,
) -> Result<ScheduledRecordingSettings, String> {
    Ok(state.read().await.get_settings().await)
}

#[tauri::command]
pub async fn set_scheduled_recording_settings(
    app: AppHandle<Wry>,
    settings: ScheduledRecordingSettings,
    state: State<'_, ScheduledRecordingState>,
) -> Result<(), String> {
    info!("Updating scheduled recording settings");
    let service = state.read().await;
    service.update_settings(&app, settings).await
}

/// Atajo on/off que persiste el flag y arranca/detiene el loop en consecuencia.
#[tauri::command]
pub async fn set_scheduled_recording_enabled(
    app: AppHandle<Wry>,
    enabled: bool,
    state: State<'_, ScheduledRecordingState>,
) -> Result<(), String> {
    info!("Setting scheduled recording enabled: {}", enabled);

    // 1. Persistir el flag en settings.
    {
        let service = state.read().await;
        let mut settings = service.get_settings().await;
        settings.enabled = enabled;
        service.update_settings(&app, settings).await?;
    }

    // 2. Arrancar o detener el loop.
    if enabled {
        let mut service = state.write().await;
        service
            .start(app)
            .await
            .map_err(|e| format!("Failed to start scheduled recording: {}", e))?;
    } else {
        let mut service = state.write().await;
        service.stop().await;
    }

    Ok(())
}

#[tauri::command]
pub async fn start_scheduled_recording_service(
    app: AppHandle<Wry>,
    state: State<'_, ScheduledRecordingState>,
) -> Result<(), String> {
    info!("Starting scheduled recording service");
    let mut service = state.write().await;
    service
        .start(app)
        .await
        .map_err(|e| format!("Failed to start scheduled recording: {}", e))
}

#[tauri::command]
pub async fn stop_scheduled_recording_service(
    state: State<'_, ScheduledRecordingState>,
) -> Result<(), String> {
    info!("Stopping scheduled recording service");
    let mut service = state.write().await;
    service.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn is_scheduled_recording_service_running(
    state: State<'_, ScheduledRecordingState>,
) -> Result<bool, String> {
    Ok(state.read().await.is_running().await)
}

#[tauri::command]
pub async fn get_scheduled_recording_status(
    state: State<'_, ScheduledRecordingState>,
) -> Result<ScheduledStatus, String> {
    Ok(state.read().await.get_status().await)
}

/// Fuerza una evaluación del horario (debug/test).
#[tauri::command]
pub async fn check_schedule_now(
    state: State<'_, ScheduledRecordingState>,
) -> Result<(), String> {
    info!("Manual schedule check triggered");
    state
        .read()
        .await
        .check_now()
        .await
        .map_err(|e| format!("Failed to trigger schedule check: {}", e))
}
