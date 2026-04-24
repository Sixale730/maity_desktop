use log::info;
use tauri::{command, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use super::service;

#[command]
pub async fn start_coach_overlay<R: Runtime>(
    app: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    info!("Starting coach overlay with model: {}", model_name);

    // Get app data dir for model resolution
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Get primary monitor to position the overlay in the bottom-right corner
    let (pos_x, pos_y) = if let Some(monitor) = app
        .get_webview_window("main")
        .and_then(|w| w.primary_monitor().ok().flatten())
    {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let screen_w = (size.width as f64 / scale) as i32;
        let screen_h = (size.height as f64 / scale) as i32;
        (screen_w - 370, screen_h - 230)
    } else {
        (1550, 850)
    };

    // Create the overlay window
    let overlay = WebviewWindowBuilder::new(
        &app,
        "coach-overlay",
        WebviewUrl::App("/overlay".into()),
    )
    .title("Maity Coach")
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .inner_size(350.0, 180.0)
    .position(pos_x as f64, pos_y as f64)
    .focused(false)
    .resizable(false)
    .build()
    .map_err(|e| format!("Failed to create coach overlay window: {}", e))?;

    let _ = overlay.set_ignore_cursor_events(false);

    // Start the coach service with Built-in AI
    service::start(&app, model_name, app_data_dir).await?;

    info!("Coach overlay started successfully");
    Ok(())
}

#[command]
pub async fn stop_coach_overlay<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    info!("Stopping coach overlay");

    service::stop(&app).await;

    if let Some(window) = app.get_webview_window("coach-overlay") {
        let _ = window.close();
    }

    info!("Coach overlay stopped");
    Ok(())
}

#[command]
pub async fn get_coach_status() -> Result<bool, String> {
    Ok(service::is_active().await)
}
