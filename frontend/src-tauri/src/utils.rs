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

/// Traduce un FILETIME crudo (ticks de 100 ns desde 1601-01-01 UTC, tal como los guarda
/// `StartupApproved\Run` en sus bytes 4..12) a RFC3339 UTC. `None` si el valor es 0 (sin
/// timestamp) o cae en/antes de la época Unix (1970-01-01T00:00:00Z, bytes corruptos/parciales)
/// — nunca inventa una fecha absurda. Pura para poder testearla sin registro
/// (`autostart_state.rs`).
pub fn filetime_ticks_to_rfc3339(ticks: u64) -> Option<String> {
    if ticks == 0 {
        return None;
    }
    // Segundos entre las épocas FILETIME (1601-01-01) y Unix (1970-01-01). Se divide en
    // u64 ANTES de pasar a i64: un `ticks` enorme no desborda el cast.
    const FILETIME_UNIX_EPOCH_DIFF_SECS: i64 = 11_644_473_600;
    let secs = (ticks / 10_000_000) as i64 - FILETIME_UNIX_EPOCH_DIFF_SECS;
    // `<= 0` (no `< 0`): secs == 0 es exactamente 1970-01-01T00:00:00Z, el límite que
    // la spec de #83 (P1a) documenta como excluido, no solo lo negativo.
    if secs <= 0 {
        return None;
    }
    // Sub-segundos descartados a propósito (nanos = 0): la fecha de un apagado del
    // autostart o de una instalación no necesita más precisión que el segundo.
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0).map(|dt| dt.to_rfc3339())
}

/// Traduce `Windows.ApplicationModel.PackageSignatureKind` (su valor i32) a texto.
/// Pura para poder testearla sin WinRT.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn signature_kind_label(kind: i32) -> &'static str {
    match kind {
        0 => "none",
        1 => "developer",
        2 => "enterprise",
        3 => "store",
        4 => "system",
        _ => "unknown",
    }
}

/// Firma del paquete MSIX: `store` sólo si lo instaló la Microsoft Store. Un MSIX
/// de prueba (`developer`, p. ej. el `.msix` local o `winapp run`) tiene identidad
/// de paquete igual, pero la Store NUNCA le sirve updates. `None` sin identidad de
/// paquete (NSIS/dev/macOS/Linux). Llamar dentro de `startup_task::with_mta`.
pub fn package_signature_kind() -> Option<&'static str> {
    if !is_running_under_package_identity() {
        return None;
    }
    #[cfg(target_os = "windows")]
    {
        match windows::ApplicationModel::Package::Current().and_then(|p| p.SignatureKind()) {
            Ok(kind) => Some(signature_kind_label(kind.0)),
            Err(e) => {
                log::warn!("[utils] Package::Current().SignatureKind() falló: {e}");
                Some("unknown")
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_kind_label_mapea_package_signature_kind() {
        assert_eq!(signature_kind_label(0), "none");
        assert_eq!(signature_kind_label(1), "developer");
        assert_eq!(signature_kind_label(2), "enterprise");
        assert_eq!(signature_kind_label(3), "store");
        assert_eq!(signature_kind_label(4), "system");
        assert_eq!(signature_kind_label(99), "unknown");
    }

    #[test]
    fn filetime_ticks_to_rfc3339_cero_es_none() {
        assert_eq!(filetime_ticks_to_rfc3339(0), None);
    }

    #[test]
    fn filetime_ticks_to_rfc3339_antes_de_unix_es_none() {
        // 1 tick (100 ns) después de la época FILETIME (1601), muy antes de 1970.
        assert_eq!(filetime_ticks_to_rfc3339(1), None);
    }

    #[test]
    fn filetime_ticks_to_rfc3339_limite_exacto_de_epoch_es_none() {
        // FILETIME de 1970-01-01T00:00:00Z exacto (unix_ticks == 0, secs == 0): la spec de
        // #83 (P1a) documenta este límite como excluido, no solo lo estrictamente negativo.
        const FILETIME_UNIX_EPOCH_DIFF_TICKS: u64 = 116_444_736_000_000_000;
        assert_eq!(filetime_ticks_to_rfc3339(FILETIME_UNIX_EPOCH_DIFF_TICKS), None);
    }

    #[test]
    fn filetime_ticks_to_rfc3339_un_tick_despues_del_epoch_no_es_none() {
        // Un solo tick (100 ns) tras la época Unix: secs sigue truncando a 0 ⇒ también
        // debe caer en None (secs <= 0), no solo el límite exacto.
        const FILETIME_UNIX_EPOCH_DIFF_TICKS: u64 = 116_444_736_000_000_000;
        assert_eq!(filetime_ticks_to_rfc3339(FILETIME_UNIX_EPOCH_DIFF_TICKS + 1), None);
    }

    #[test]
    fn filetime_ticks_to_rfc3339_primer_segundo_tras_epoch_convierte() {
        // Ya en secs == 1 (10_000_000 ticks tras la época), sí debe convertir.
        const FILETIME_UNIX_EPOCH_DIFF_TICKS: u64 = 116_444_736_000_000_000;
        assert_eq!(
            filetime_ticks_to_rfc3339(FILETIME_UNIX_EPOCH_DIFF_TICKS + 10_000_000).as_deref(),
            Some("1970-01-01T00:00:01+00:00")
        );
    }

    #[test]
    fn filetime_ticks_to_rfc3339_convierte_fecha_conocida() {
        // FILETIME de 2024-01-01T00:00:00Z.
        let ticks: u64 = 133_485_408_000_000_000;
        assert_eq!(
            filetime_ticks_to_rfc3339(ticks).as_deref(),
            Some("2024-01-01T00:00:00+00:00")
        );
    }

    #[test]
    fn filetime_ticks_to_rfc3339_convierte_2026() {
        assert_eq!(
            filetime_ticks_to_rfc3339(134_116_992_000_000_000).as_deref(),
            Some("2026-01-01T00:00:00+00:00")
        );
    }

    #[test]
    fn filetime_ticks_to_rfc3339_trunca_sub_segundos() {
        // 999.9999 ms después de 2026-01-01T00:00:00Z: el caso literal del plan (P1a).
        assert_eq!(
            filetime_ticks_to_rfc3339(134_116_992_009_999_999).as_deref(),
            Some("2026-01-01T00:00:00+00:00")
        );
    }
}
