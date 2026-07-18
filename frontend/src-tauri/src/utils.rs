pub fn format_timestamp(seconds: f64) -> String {
    let total_seconds = seconds as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

/// Detecta si el proceso corre bajo identidad de paquete MSIX (instalado
/// desde la Microsoft Store o registrado con winapp/Add-AppxPackage).
/// Bajo MSIX las actualizaciones las gestiona la Store: el auto-updater de
/// GitHub instalaría una segunda copia Win32 en paralelo a la de la Store.
#[tauri::command]
pub fn is_running_under_package_identity() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
        use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

        let mut length: u32 = 0;
        // Con buffer nulo: proceso empaquetado → ERROR_INSUFFICIENT_BUFFER (122);
        // proceso sin identidad de paquete → APPMODEL_ERROR_NO_PACKAGE (15700).
        let rc = unsafe { GetCurrentPackageFullName(&mut length, PWSTR::null()) };
        rc == ERROR_INSUFFICIENT_BUFFER
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Opens macOS System Settings to a specific privacy preference pane
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_system_settings(preference_pane: String) -> Result<(), String> {
    use std::process::Command;

    // Construct the URL for System Settings
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{}", preference_pane);

    // Use the 'open' command on macOS to open the URL
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open system settings: {}", e))?;

    Ok(())
} 