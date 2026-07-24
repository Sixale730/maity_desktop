//! Autostart del canal MSIX/Store vía `<desktop:StartupTask>` del Package.appxmanifest.
//!
//! El canal NSIS (descarga directa) sigue usando tauri-plugin-autostart, que escribe
//! `HKCU\...\Run\Maity` con el arg `--autostart`. Bajo MSIX ese mecanismo no aplica:
//! el arranque lo declara el manifest (TaskId `MaityStartup`, Enabled=true de fábrica)
//! y Windows lanza el exe SIN argumentos, así que el "arrancado al boot" se detecta
//! con WinRT (`GetActivatedEventArgs` → `ActivationKind::StartupTask`).
//!
//! El estado del task lo puede cambiar el usuario desde Task Manager / Configuración;
//! si él lo apagó ahí (`DisabledByUser`), la app NO puede reactivarlo — solo mandarlo
//! a `ms-settings:startupapps` (ver `open_startup_settings`).

/// DEBE coincidir con el TaskId del `<desktop:StartupTask>` en frontend/Package.appxmanifest.
/// No cambiarlo: Windows persiste el estado (enabled/disabled) por TaskId.
#[cfg(target_os = "windows")]
pub const STARTUP_TASK_ID: &str = "MaityStartup";

/// true si ESTE proceso fue lanzado por el startupTask del paquete MSIX.
///
/// Corre en un hilo desechable con COM MTA propio: el main thread lo inicializa
/// wry como STA más adelante, y un `CoInitializeEx(MTA)` previo ahí provocaría
/// `RPC_E_CHANGED_MODE`. Lanzamiento manual (tile del menú inicio) devuelve
/// null/Err o `ActivationKind::Launch` — ambos caen a `false`.
#[cfg(target_os = "windows")]
pub fn launched_by_startup_task() -> bool {
    std::thread::spawn(|| {
        use windows::ApplicationModel::Activation::ActivationKind;
        use windows::ApplicationModel::AppInstance;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        AppInstance::GetActivatedEventArgs()
            .and_then(|args| args.Kind())
            .map(|kind| kind == ActivationKind::StartupTask)
            .unwrap_or(false)
    })
    .join()
    .unwrap_or(false)
}

/// Ejecuta `f` en un hilo bloqueante con COM MTA inicializado. Los `.get()` de
/// `IAsyncOperation` bloquean (y no deben esperarse en STA), de ahí el spawn_blocking.
#[cfg(target_os = "windows")]
async fn with_mta<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        f()
    })
    .await
    .map_err(|e| format!("spawn_blocking falló: {e}"))?
}

#[cfg(target_os = "windows")]
fn map_state(state: windows::ApplicationModel::StartupTaskState) -> &'static str {
    use windows::ApplicationModel::StartupTaskState as S;
    if state == S::Enabled {
        "enabled"
    } else if state == S::EnabledByPolicy {
        "enabledByPolicy"
    } else if state == S::Disabled {
        "disabled"
    } else if state == S::DisabledByUser {
        "disabledByUser"
    } else if state == S::DisabledByPolicy {
        "disabledByPolicy"
    } else {
        "unknown"
    }
}

#[cfg(target_os = "windows")]
fn get_task() -> Result<windows::ApplicationModel::StartupTask, String> {
    use windows::core::HSTRING;
    windows::ApplicationModel::StartupTask::GetAsync(&HSTRING::from(STARTUP_TASK_ID))
        .and_then(|op| op.get())
        .map_err(|e| format!("StartupTask::GetAsync({STARTUP_TASK_ID}) falló: {e}"))
}

/// Estado del startupTask MSIX para el toggle de Settings.
/// `"unsupported"` fuera de MSIX (NSIS/dev/no-Windows): ahí el toggle usa el plugin.
#[tauri::command]
pub async fn startup_task_get_state() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if !crate::utils::is_running_under_package_identity() {
            return Ok("unsupported".into());
        }
        return with_mta(|| {
            let state = get_task()?.State().map_err(|e| e.to_string())?;
            Ok(map_state(state).to_string())
        })
        .await;
    }
    #[cfg(not(target_os = "windows"))]
    Ok("unsupported".into())
}

/// Intenta habilitar el startupTask y devuelve el estado resultante. En desktop
/// apps `RequestEnableAsync` NO muestra diálogo: si el usuario lo apagó en Task
/// Manager devuelve `"disabledByUser"` y el frontend debe ofrecer `open_startup_settings`.
#[tauri::command]
pub async fn startup_task_request_enable() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if !crate::utils::is_running_under_package_identity() {
            return Err("startupTask solo existe bajo identidad de paquete MSIX".into());
        }
        return with_mta(|| {
            let state = get_task()?
                .RequestEnableAsync()
                .and_then(|op| op.get())
                .map_err(|e| format!("RequestEnableAsync falló: {e}"))?;
            Ok(map_state(state).to_string())
        })
        .await;
    }
    #[cfg(not(target_os = "windows"))]
    Err("unsupported".into())
}

#[tauri::command]
pub async fn startup_task_disable() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if !crate::utils::is_running_under_package_identity() {
            return Err("startupTask solo existe bajo identidad de paquete MSIX".into());
        }
        return with_mta(|| get_task()?.Disable().map_err(|e| format!("Disable falló: {e}"))).await;
    }
    #[cfg(not(target_os = "windows"))]
    Err("unsupported".into())
}

/// Abre Configuración > Aplicaciones > Inicio, para el caso `disabledByUser`
/// (la app no puede reactivar el task; solo el usuario desde ahí).
#[tauri::command]
pub fn open_startup_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:startupapps"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("no se pudo abrir ms-settings:startupapps: {e}"))
    }
    #[cfg(not(target_os = "windows"))]
    Err("unsupported".into())
}
