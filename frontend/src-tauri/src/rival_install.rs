//! Detección y remoción de la instalación "rival" cuando Maity convive en dos canales.
//!
//! Maity se distribuye por DOS canales en paralelo desde el mismo código: instalador
//! NSIS `.exe` (GitHub Releases) y MSIX (Microsoft Store). Ambos escriben la MISMA
//! SQLite en `%APPDATA%\com.maity.ai` (no hay redirección de AppData bajo
//! `Windows.FullTrustApplication`). Si un usuario termina con las dos instaladas:
//!   - Dos entradas en menú inicio + dos autostart.
//!   - Contención del micrófono y del sync queue sobre la misma DB.
//!   - Version-skew: la versión más nueva migra la DB "hacia adelante" y la vieja
//!     (anterior a `set_ignore_missing(true)`, v0.2.51) ya no puede abrirla → error de DB.
//!
//! Estrategia (alcance elegido): la Store es SIEMPRE el canal sobreviviente. Cuando Maity
//! corre bajo identidad de paquete (MSIX) y detecta la instalación NSIS de descarga
//! directa, ofrece quitarla con un clic. NO se cubre la dirección inversa.
//!
//! Enfoque pull-based: el frontend consulta `get_rival_install` al montar (espeja
//! `updateService.isManagedByStore()` que invoca `is_running_under_package_identity`).

use serde::Serialize;

/// Datos de la instalación rival detectada (por ahora, solo NSIS).
#[derive(Serialize, Clone, Debug)]
pub struct RivalInstallInfo {
    /// Tipo de instalación rival. Actualmente siempre `"nsis"`.
    pub kind: String,
    /// `DisplayName` del registro (ej. "Maity").
    pub display_name: String,
    /// `DisplayVersion` del registro (ej. "0.2.49"). Puede venir vacío.
    pub version: String,
    /// `UninstallString` del registro, tal cual (puede venir con comillas).
    pub uninstall_string: String,
    /// `InstallLocation` del registro (puede venir con comillas / vacío).
    pub install_location: String,
}

/// Devuelve `Some(info)` SOLO cuando Maity corre bajo identidad de paquete (MSIX/Store)
/// Y existe una instalación NSIS (descarga directa) registrada. En cualquier otro caso
/// (proceso Win32 puro, sin rival, o plataforma no-Windows): `None`.
#[tauri::command]
pub fn get_rival_install() -> Option<RivalInstallInfo> {
    #[cfg(target_os = "windows")]
    {
        // Solo soportamos la dirección Store→quitar NSIS: si NO corremos empaquetados,
        // no hay nada que ofrecer (no desinstalamos la Store desde el .exe).
        if !crate::utils::is_running_under_package_identity() {
            return None;
        }
        read_nsis_uninstall_entry()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Desinstala la instalación NSIS rival y relanza la MSIX.
///
/// NO corre el uninstaller in-process: el uninstaller NSIS hace `taskkill /im
/// maity-desktop.exe` por NOMBRE DE IMAGEN → mataría también la app MSIX que corre (mismo
/// exe). Por eso delega todo a un orquestador PowerShell desacoplado (ver
/// `launch_detached_uninstaller`) que sobrevive al cierre y reabre la app. Devuelve `Ok(())`
/// apenas lanza ese orquestador (la app se cerrará y volverá a abrir sola).
#[tauri::command]
pub async fn uninstall_rival() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let info = get_rival_install().ok_or_else(|| "No se detectó instalación rival".to_string())?;
        launch_detached_uninstaller(&info)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("uninstall_rival solo está soportado en Windows".to_string())
    }
}

// ───────────────────────────── Implementación Windows ─────────────────────────────

#[cfg(target_os = "windows")]
const NSIS_UNINSTALL_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Maity";

/// Lee la clave de desinstalación NSIS de Maity. El instalador NSIS de Tauri (modo
/// `currentUser` por defecto) escribe en HKCU; chequeamos también HKLM por si un usuario
/// instaló perMachine.
#[cfg(target_os = "windows")]
fn read_nsis_uninstall_entry() -> Option<RivalInstallInfo> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        let key = match root.open_subkey(NSIS_UNINSTALL_SUBKEY) {
            Ok(k) => k,
            Err(_) => continue,
        };

        // Un uninstall_string vacío/ausente no sirve para desinstalar → ignorar esa entrada.
        let uninstall_string: String = key.get_value("UninstallString").unwrap_or_default();
        if uninstall_string.trim().is_empty() {
            continue;
        }

        let display_name: String = key
            .get_value("DisplayName")
            .unwrap_or_else(|_| "Maity".to_string());
        let version: String = key.get_value("DisplayVersion").unwrap_or_default();
        let install_location: String = key.get_value("InstallLocation").unwrap_or_default();

        log::info!(
            "[rival_install] Instalación NSIS rival detectada: {} v{} en {}",
            display_name,
            version,
            install_location
        );

        return Some(RivalInstallInfo {
            kind: "nsis".to_string(),
            display_name,
            version,
            uninstall_string,
            install_location,
        });
    }
    None
}

/// Lanza un orquestador `.cmd` DESACOPLADO (fuera del job MSIX) que desinstala el rival y
/// relanza la MSIX. Necesario porque el uninstaller NSIS hace `taskkill /im maity-desktop.exe`
/// POR NOMBRE DE IMAGEN → cierra también la app MSIX que corre (mismo nombre de exe, verificado
/// empíricamente). Como no se puede evitar ese cierre, delegamos a un `cmd.exe` externo que
/// sobrevive al kill (no se llama maity-desktop.exe) y al teardown del job (BREAKAWAY), y que
/// reabre la app cuando el uninstall termina.
#[cfg(target_os = "windows")]
fn launch_detached_uninstaller(info: &RivalInstallInfo) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // CREATE_NO_WINDOW: sin consola visible (mismo flag que summary_engine/sidecar.rs).
    // CREATE_BREAKAWAY_FROM_JOB: saca al orquestador del job del paquete MSIX para que NO
    // muera cuando el uninstaller cierre la app. NO combinar con DETACHED_PROCESS: son flags
    // de consola MUTUAMENTE EXCLUYENTES → CreateProcess deja el proceso en estado inválido y
    // el orquestador no llega a ejecutarse (causa del intento fallido anterior).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

    // El UninstallString del registro viene entre comillas: "C:\...\uninstall.exe".
    let exe = info.uninstall_string.trim().trim_matches('"').to_string();
    if exe.is_empty() {
        return Err("UninstallString vacío".to_string());
    }
    let aumid = current_aumid();

    // Escribir el orquestador a %LOCALAPPDATA%\Maity\rival-cleanup.cmd
    let local =
        std::env::var("LOCALAPPDATA").map_err(|e| format!("LOCALAPPDATA no disponible: {}", e))?;
    let dir = std::path::Path::new(&local).join("Maity");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("no se pudo crear {}: {}", dir.display(), e))?;
    let script_path = dir.join("rival-cleanup.cmd");
    let script = build_cleanup_batch(&exe, &aumid);
    std::fs::File::create(&script_path)
        .and_then(|mut f| f.write_all(script.as_bytes()))
        .map_err(|e| format!("no se pudo escribir {}: {}", script_path.display(), e))?;

    let script_str = script_path.to_string_lossy().to_string();
    log::info!(
        "[rival_install] Lanzando orquestador desacoplado (uninstall + relaunch AUMID {}): {}",
        aumid,
        script_str
    );
    // `cmd.exe /c <batch>` corre el orquestador; cmd.exe NO se llama maity-desktop.exe (el
    // taskkill del uninstaller no lo toca) y con BREAKAWAY sobrevive al teardown del job MSIX.
    Command::new("cmd.exe")
        .args(["/c", &script_str])
        .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
        .map_err(|e| format!("no se pudo lanzar el orquestador cmd.exe: {}", e))?;

    Ok(())
}

/// AUMID de la app empaquetada en runtime (`GetCurrentApplicationUserModelId`), para
/// relanzarnos por `shell:AppsFolder\<AUMID>`. Fallback al valor conocido si la API falla.
#[cfg(target_os = "windows")]
fn current_aumid() -> String {
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

/// Escapa `%` (introductor de variables de batch) en un literal a incrustar en el `.cmd`.
#[cfg(target_os = "windows")]
fn bat_lit(s: &str) -> String {
    s.replace('%', "%%")
}

/// Genera el orquestador `.cmd` (CRLF, sin PowerShell → sin ExecutionPolicy). Secuencia:
/// corre `uninstaller /S` → espera a que desaparezca la clave de desinstalación (poll con
/// `reg query`, timeout ~2min) → borra el autostart huérfano `Run\Maity` (bajo MSIX no
/// escribimos esa clave, así que la única presente es la del NSIS) → relanza la MSIX por
/// AUMID. Loguea a `%LOCALAPPDATA%\Maity\logs\rival-cleanup.log`.
#[cfg(target_os = "windows")]
fn build_cleanup_batch(uninstaller_exe: &str, aumid: &str) -> String {
    const TEMPLATE: &str = concat!(
        "@echo off\r\n",
        "set \"LOGF=%LOCALAPPDATA%\\Maity\\logs\\rival-cleanup.log\"\r\n",
        ">>\"%LOGF%\" echo [%date% %time%] start\r\n",
        "start \"\" \"@@UNINSTALLER@@\" /S\r\n",
        "set /a n=0\r\n",
        ":wait\r\n",
        "reg query \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Maity\" >nul 2>&1\r\n",
        "if errorlevel 1 goto gone\r\n",
        "set /a n+=1\r\n",
        "if %n% geq 120 goto gone\r\n",
        ">nul ping -n 2 127.0.0.1\r\n",
        "goto wait\r\n",
        ":gone\r\n",
        ">>\"%LOGF%\" echo [%date% %time%] uninstall confirmado (o timeout), limpiando y relanzando\r\n",
        ">nul ping -n 4 127.0.0.1\r\n",
        "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\" /v Maity /f >nul 2>&1\r\n",
        "explorer.exe \"shell:AppsFolder\\@@AUMID@@\"\r\n",
        ">>\"%LOGF%\" echo [%date% %time%] done\r\n",
    );
    TEMPLATE
        .replace("@@UNINSTALLER@@", &bat_lit(uninstaller_exe))
        .replace("@@AUMID@@", &bat_lit(aumid))
}
