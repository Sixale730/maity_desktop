//! Detección y remoción de la instalación "rival" cuando Maity convive en dos canales.
//!
//! Maity se distribuye por DOS canales en paralelo desde el mismo código: instalador
//! NSIS `.exe` (GitHub Releases) y MSIX (Microsoft Store). El MSIX instalado SÍ redirige
//! AppData (su SQLite vive en `LocalCache\Roaming\com.maity.ai`, corregido 2026-07-27),
//! así que NO comparten DB — pero la convivencia sigue siendo dañina:
//!   - Dos entradas en menú inicio + dos autostart.
//!   - Contención del micrófono entre ambas instancias.
//!   - Confusión de canal: el usuario no sabe cuál Maity abrió ni dónde quedaron sus datos.
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
/// exe). Por eso delega todo a un orquestador `.cmd` desacoplado (ver
/// `launch_detached_uninstaller`) que sobrevive al cierre y reabre la app.
///
/// Protección de la DB (issue #64, incidente real 2026-07-30): un kill a mitad de un write
/// SQLite bajo la virtualización copy-on-write del MSIX corrompió la DB de LocalCache
/// ("database disk image is malformed"). Secuencia actual: persistir grabación activa →
/// checkpoint WAL → respaldo `.bak` → lanzar orquestador (que ESPERA la muerte de nuestro
/// PID antes de correr el uninstaller) → cerrar el pool → salida limpia diferida. Si el
/// spawn del orquestador falla, el pool sigue abierto y la app queda 100% funcional.
#[tauri::command]
pub async fn uninstall_rival(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;

        let info = get_rival_install().ok_or_else(|| "No se detectó instalación rival".to_string())?;

        // 1. Persistir la grabación activa (si la hay) con el pool ABIERTO. Idempotente
        //    vía StopGate: el RunEvent::Exit posterior será no-op.
        crate::graceful_shutdown_before_exit(&app).await;

        // 2-3. Checkpoint + respaldo, best-effort: un fallo aquí no debe bloquear la
        //      desinstalación (el checkpoint del paso 5 y el PID-wait del batch siguen
        //      protegiendo el archivo principal).
        let db = app
            .try_state::<crate::state::AppState>()
            .map(|s| s.db_manager.clone());
        if let Some(db) = &db {
            if let Err(e) = db.checkpoint().await {
                log::warn!("[rival_install] checkpoint WAL falló (no fatal): {}", e);
            }
            match app.path().app_data_dir() {
                Ok(dir) => {
                    let db_path = dir.join("meeting_minutes.sqlite");
                    let bak_path = dir.join("meeting_minutes.sqlite.bak");
                    if let Err(e) = db.backup_to(&db_path, &bak_path).await {
                        log::warn!("[rival_install] respaldo .bak falló (no fatal): {}", e);
                    }
                }
                Err(e) => log::warn!("[rival_install] app_data_dir no disponible: {}", e),
            }
        }

        // 4. Lanzar el orquestador. Si FALLA: el pool sigue abierto → app funcional,
        //    el usuario ve el toast de error y puede reintentar.
        launch_detached_uninstaller(&info, std::process::id())?;

        // 5. COMMIT POINT: cerrar el pool (checkpoint redundante + close). Desde aquí
        //    la app ya no puede tocar la DB; morirá en el paso 6.
        if let Some(db) = db {
            let _ = db.cleanup().await;
        }

        // 6. Salida limpia diferida: 800ms para que la respuesta de este invoke llegue al
        //    webview (<50ms típico). Morimos ANTES de que corra el uninstaller — su batch
        //    espera la desaparición de nuestro PID — así el taskkill del NSIS ya no
        //    encuentra a la MSIX y no puede partir ningún write.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            handle.exit(0);
        });

        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
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
fn launch_detached_uninstaller(info: &RivalInstallInfo, own_pid: u32) -> Result<(), String> {
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
    let aumid = crate::utils::current_aumid();

    // Escribir el orquestador a %LOCALAPPDATA%\Maity\rival-cleanup.cmd
    let local =
        std::env::var("LOCALAPPDATA").map_err(|e| format!("LOCALAPPDATA no disponible: {}", e))?;
    let dir = std::path::Path::new(&local).join("Maity");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("no se pudo crear {}: {}", dir.display(), e))?;
    let script_path = dir.join("rival-cleanup.cmd");
    let script = build_cleanup_batch(&exe, &aumid, own_pid);
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

// `current_aumid()` vive ahora en `crate::utils` — la comparte el transporte de toasts
// nativos (`notifications/toast.rs`), que necesita el mismo AUMID como `app_id`.

/// Escapa `%` (introductor de variables de batch) en un literal a incrustar en el `.cmd`.
#[cfg(target_os = "windows")]
fn bat_lit(s: &str) -> String {
    s.replace('%', "%%")
}

/// Genera el orquestador `.cmd` (CRLF, sin PowerShell → sin ExecutionPolicy). Secuencia:
/// **espera la muerte de nuestro PID** (issue #64: así el `taskkill /im maity-desktop.exe`
/// del uninstaller nunca encuentra a la MSIX viva y no puede partir un write de SQLite;
/// timeout ~90s > presupuesto de salida limpia de 30s) → corre `uninstaller /S` → espera a
/// que desaparezca la clave de desinstalación (poll con `reg query`, timeout ~2min) → borra
/// el autostart huérfano `Run\Maity` (bajo MSIX no escribimos esa clave, así que la única
/// presente es la del NSIS) → relanza la MSIX por AUMID. Loguea a
/// `%LOCALAPPDATA%\Maity\logs\rival-cleanup.log`.
#[cfg(target_os = "windows")]
fn build_cleanup_batch(uninstaller_exe: &str, aumid: &str, own_pid: u32) -> String {
    const TEMPLATE: &str = concat!(
        "@echo off\r\n",
        "set \"LOGF=%LOCALAPPDATA%\\Maity\\logs\\rival-cleanup.log\"\r\n",
        ">>\"%LOGF%\" echo [%date% %time%] start (esperando salida del PID @@PID@@)\r\n",
        // PID-wait: filtrar por PID E IMAGENAME juntos (anti reuso de PID). Cuando no hay
        // match, tasklist imprime un INFO localizado sin el número → `find` falla → :dead.
        "set /a w=0\r\n",
        ":waitkill\r\n",
        "tasklist /fi \"PID eq @@PID@@\" /fi \"IMAGENAME eq maity-desktop.exe\" | find \"@@PID@@\" >nul 2>&1\r\n",
        "if errorlevel 1 goto dead\r\n",
        "set /a w+=1\r\n",
        "if %w% geq 90 goto dead\r\n",
        ">nul ping -n 2 127.0.0.1\r\n",
        "goto waitkill\r\n",
        ":dead\r\n",
        ">>\"%LOGF%\" echo [%date% %time%] app cerrada (o timeout), corriendo uninstaller\r\n",
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
        .replace("@@PID@@", &own_pid.to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod batch_tests {
    use super::*;

    #[test]
    fn pid_wait_va_antes_del_uninstaller() {
        let batch = build_cleanup_batch(r"C:\Apps\Maity\uninstall.exe", "PFN!Maity", 4321);
        let wait_pos = batch
            .find("tasklist /fi \"PID eq 4321\"")
            .expect("falta el PID-wait");
        let start_pos = batch
            .find("start \"\" \"C:\\Apps\\Maity\\uninstall.exe\" /S")
            .expect("falta la línea del uninstaller");
        assert!(
            wait_pos < start_pos,
            "el PID-wait debe correr ANTES de lanzar el uninstaller"
        );
    }

    #[test]
    fn pid_sustituido_en_wait_y_find() {
        let batch = build_cleanup_batch(r"C:\u.exe", "PFN!Maity", 9876);
        assert!(!batch.contains("@@PID@@"), "placeholder sin sustituir");
        assert!(batch.contains("PID eq 9876"));
        assert!(batch.contains("| find \"9876\""));
        // Cota del wait presente (timeout ~90 iteraciones).
        assert!(batch.contains("if %w% geq 90 goto dead"));
    }

    #[test]
    fn batch_usa_crlf_y_escapa_porcentajes() {
        let batch = build_cleanup_batch(r"C:\ruta con %APPDATA% literal\u.exe", "PFN!Maity", 1);
        assert!(batch.contains("\r\n"));
        assert!(!batch.contains('\n') || batch.matches('\n').count() == batch.matches("\r\n").count());
        // bat_lit duplica el % del literal para que cmd no lo expanda.
        assert!(batch.contains("%%APPDATA%%"));
        // Las variables PROPIAS del batch quedan sin escapar.
        assert!(batch.contains("%LOGF%"));
        assert!(batch.contains("%w%"));
    }
}
