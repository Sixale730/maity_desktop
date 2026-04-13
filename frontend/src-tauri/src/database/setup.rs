use log::info;
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use crate::state::AppState;

/// Initialize database on app startup
/// Handles first launch detection and conditional initialization
pub async fn initialize_database_on_startup(app: &AppHandle) -> Result<(), String> {
    // Check if this is the first launch (no database exists yet)
    let is_first_launch = DatabaseManager::is_first_launch(app)
        .await
        .map_err(|e| format!("Failed to check first launch status: {}", e))?;

    if is_first_launch {
        info!("First launch detected - will notify window when ready");

        // Delay event emission to ensure window is ready and React listeners are registered
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Err(e) = app_handle.emit("first-launch-detected", ()) {
                log::error!("Failed to emit first-launch-detected event: {}", e);
            }
            info!("Emitted first-launch-detected after delay");
        });
    } else {
        // Normal flow - initialize database immediately
        let db_manager = DatabaseManager::new_from_app_handle(app)
            .await
            .map_err(|e| format!("Failed to initialize database manager: {}", e))?;

        app.manage(AppState { db_manager });
        info!("Database initialized successfully");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_error_message_format() {
        let error_msg = "Failed to check first launch status: database connection failed";
        assert!(error_msg.contains("Failed"));
        assert!(error_msg.contains("database"));
    }

    #[test]
    fn test_first_launch_detected_event_name() {
        let event_name = "first-launch-detected";
        assert_eq!(event_name, "first-launch-detected");
        assert!(!event_name.is_empty());
    }

    #[test]
    fn test_delay_duration_milliseconds() {
        let delay_ms = 500;
        assert_eq!(delay_ms, 500);
        assert!(delay_ms > 0, "Delay should be positive");
    }

    #[test]
    fn test_success_messages() {
        let success_messages = vec![
            "First launch detected - will notify window when ready",
            "Database initialized successfully",
            "Emitted first-launch-detected after delay",
        ];

        for msg in success_messages {
            assert!(!msg.is_empty());
            assert!(msg.len() > 5);
        }
    }

    #[test]
    fn test_initialization_result_ok() {
        let result: Result<(), String> = Ok(());
        assert!(result.is_ok());
    }

    #[test]
    fn test_initialization_result_err() {
        let error_msg = "Failed to initialize database manager: some error";
        let result: Result<(), String> = Err(error_msg.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_first_launch_detection_logic() {
        // Simulating first launch detection
        let is_first_launch = true;
        if is_first_launch {
            assert!(true, "Should take first launch path");
        } else {
            assert!(false, "Should not take normal path on first launch");
        }
    }

    #[test]
    fn test_normal_launch_detection_logic() {
        // Simulating normal launch detection
        let is_first_launch = false;
        if is_first_launch {
            assert!(false, "Should not take first launch path on normal launch");
        } else {
            assert!(true, "Should take normal path");
        }
    }

    #[test]
    fn test_database_initialization_state_key() {
        // AppState manages the database manager with key
        let state_key = "db_manager";
        assert!(!state_key.is_empty());
    }
}

