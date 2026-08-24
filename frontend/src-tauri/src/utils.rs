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

/// true cuando la app corre como build de Mac App Store.
///
/// Apple prohibe que una app de la Store se auto-actualice (guideline 2.4.5):
/// las actualizaciones las gestiona la Store. Es el equivalente macOS de
/// `is_running_under_package_identity`, que solo detecta MSIX en Windows.
///
/// Dos señales, en este orden:
///
/// 1. **Sandbox** (`APP_SANDBOX_CONTAINER_ID`). La Store exige `app-sandbox`
///    y los builds de Developer ID no lo llevan, asi que basta para distinguir
///    los dos canales. Va primero porque es la unica que funciona al probar el
///    `.pkg` localmente — una copia instalada a mano NO trae recibo.
/// 2. **Recibo de la Store** (`Contents/_MASReceipt/receipt`). Solo existe en
///    copias que la App Store instalo de verdad. Es la señal canonica en
///    produccion, pero llega tarde para la prueba local.
#[tauri::command]
pub fn is_mac_app_store_build() -> bool {
    #[cfg(target_os = "macos")]
    {
        if std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some() {
            return true;
        }
        // current_exe = Maity.app/Contents/MacOS/Maity -> subir dos niveles a Contents/
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().and_then(|p| p.parent()).map(|c| c.to_path_buf()))
            .map(|contents| contents.join("_MASReceipt").join("receipt").exists())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// AUMID de la app empaquetada en runtime (`GetCurrentApplicationUserModelId`). Fallback al
/// valor conocido si la API falla.
///
/// Dos consumidores: relanzarnos por `shell:AppsFolder\<AUMID>` tras quitar la instalación
/// rival (`rival_install.rs`) y el `app_id` del toast nativo bajo MSIX
/// (`notifications/toast.rs`).
///
/// **Solo tiene sentido llamarla si `is_running_under_package_identity()` es `true`.** En un
/// proceso SIN identidad de paquete devuelve el FALLBACK hardcodeado, que como `app_id` de
/// toast sería un AUMID ajeno y reproduciría en espejo el bug que arreglamos: Windows
/// rechazaría el toast en silencio.
#[cfg(target_os = "windows")]
pub fn current_aumid() -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
    use windows::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;

    // PFN "sagrado" (Sixale.Maity_q5b9hqhck1xz0) + Application Id "Maity" del manifest.
    const FALLBACK: &str = "Sixale.Maity_q5b9hqhck1xz0!Maity";

    unsafe {
        let mut len: u32 = 0;
        if GetCurrentApplicationUserModelId(&mut len, PWSTR::null()) != ERROR_INSUFFICIENT_BUFFER {
            return FALLBACK.to_string();
        }
        let mut buf = vec![0u16; len as usize];
        if GetCurrentApplicationUserModelId(&mut len, PWSTR(buf.as_mut_ptr())) != ERROR_SUCCESS {
            return FALLBACK.to_string();
        }
        // `len` incluye el terminador NUL.
        let end = (len as usize).saturating_sub(1);
        let s = String::from_utf16_lossy(&buf[..end]);
        if s.is_empty() {
            FALLBACK.to_string()
        } else {
            s
        }
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