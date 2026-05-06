use log::{error, info};
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use crate::state::AppState;

/// Initialize database on app startup.
///
/// CRITICAL: ALWAYS calls `app.manage(AppState { db_manager })` — even on first launch.
/// This prevents `state() called before manage()` panics from any code path that
/// accesses AppState directly (recording_pipeline, coach commands, etc.) before the
/// user completes the onboarding flow.
///
/// The first-launch event is still emitted so the frontend can show the import dialog.
pub async fn initialize_database_on_startup(app: &AppHandle) -> Result<(), String> {
    info!("[DB Init] Starting database initialization");

    let is_first_launch = match DatabaseManager::is_first_launch(app).await {
        Ok(v) => {
            info!("[DB Init] is_first_launch = {}", v);
            v
        }
        Err(e) => {
            error!("[DB Init] FAILED is_first_launch check: {}", e);
            return Err(format!("Failed to check first launch status: {}", e));
        }
    };

    info!("[DB Init] Calling new_from_app_handle (will run sqlx migrations)...");
    let db_manager = match DatabaseManager::new_from_app_handle(app).await {
        Ok(m) => {
            info!("[DB Init] new_from_app_handle SUCCESS — migrations applied/validated");
            m
        }
        Err(e) => {
            error!(
                "[DB Init] FAILED new_from_app_handle: {}. \
                 If this is 'previously applied migration was modified', the migration \
                 file changed line endings (CRLF/LF) — fix by normalizing to LF.",
                e
            );
            return Err(format!("Failed to initialize database manager: {}", e));
        }
    };

    info!("[DB Init] Calling app.manage(AppState)...");
    app.manage(AppState {
        db_manager,
        current_user_id: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
    });
    info!(
        "[DB Init] AppState managed successfully (first_launch={})",
        is_first_launch
    );

    if is_first_launch {
        info!("[DB Init] First launch detected - will notify window when ready");

        // Delay event emission to ensure window is ready and React listeners are registered
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Err(e) = app_handle.emit("first-launch-detected", ()) {
                error!("Failed to emit first-launch-detected event: {}", e);
            } else {
                info!("Emitted first-launch-detected after delay");
            }
        });
    }

    Ok(())
}
