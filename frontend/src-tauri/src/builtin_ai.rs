use log::info;
use tauri::{AppHandle, Manager, Runtime};

/// Get the models directory path for built-in AI models
#[tauri::command]
pub async fn builtin_ai_get_models_directory<R: Runtime>(
    app: AppHandle<R>,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = app_data_dir.join("models");

    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    info!(
        "Returning models directory: {}",
        models_dir.to_string_lossy()
    );
    Ok(models_dir.to_string_lossy().to_string())
}

/// Open the models folder in the system file explorer
#[tauri::command]
pub async fn open_models_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = app_data_dir.join("models");

    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    let folder_path = models_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened models folder: {}", folder_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_ai_module_loads() {
        // Compile-time test to ensure module structure is correct
        assert!(true);
    }
}
