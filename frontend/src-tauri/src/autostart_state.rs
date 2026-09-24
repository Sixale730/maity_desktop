//! Estado real del autostart en **canal directo** (NSIS/dev): distingue "nunca configurado"
//! (`disabled`) de "el usuario lo apagó desde el Administrador de tareas de Windows"
//! (`disabledByUser`) — algo que `app.autolaunch().is_enabled()` (tauri-plugin-autostart) no
//! puede contar porque solo devuelve `true`/`false`. #83 AC-9.
//!
//! Bajo MSIX el estado sale de `startup_task.rs` (el `<desktop:StartupTask>` del manifest);
//! aquí solo se lee el registro `Run` que usa tauri-plugin-autostart en canal directo, con el
//! MISMO predicado que `auto-launch` 0.5.0 (`windows.rs::is_enabled`/`task_manager_enabled`)
//! para no divergir del criterio que el propio plugin usa al togglear:
//! - Sin valor `Run` ⇒ `disabled`.
//! - Con valor `Run` y sin cola de `StartupApproved\Run` (ausente, <8 bytes, o últimos 8
//!   bytes en cero) ⇒ `enabled`.
//! - Con valor `Run` y cola distinta de cero ⇒ `disabledByUser`, con `disabled_at` leído de
//!   los bytes 4..12 de la cola (FILETIME de cuándo Task Manager lo apagó).
//!
//! En otros SO (macOS/Linux) no hay predicado propio: se delega en el plugin, mecanismo
//! `plugin`, igual que antes de este módulo.

use serde::Serialize;

/// Nombre de valor bajo `HKCU\...\Run` y `...\StartupApproved\Run` que usa
/// tauri-plugin-autostart en canal directo (`app.package_info().name`, que resuelve al
/// productName `"Maity"` — hecho verificado en el planeo de #83; ver CLAUDE.md).
#[cfg(target_os = "windows")]
const AUTOSTART_VALUE_NAME: &str = "Maity";

#[cfg(target_os = "windows")]
const RUN_REGKEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const TASK_MANAGER_OVERRIDE_REGKEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// Snapshot del estado de autoarranque para ESTE canal/proceso.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AutostartSnapshot {
    /// `enabled | enabledByPolicy | disabled | disabledByUser | disabledByPolicy | unknown`.
    pub state: String,
    /// RFC3339 UTC de cuándo Task Manager lo apagó (solo con `state == "disabledByUser"` en
    /// canal directo); `None` en cualquier otro caso.
    pub disabled_at: Option<String>,
    /// `startup_task` (MSIX) | `run_key` (directo, Windows) | `plugin` (otros SO).
    pub mechanism: &'static str,
}

/// Estado real del autostart para ESTE canal. Bajo MSIX delega en `startup_task` (el
/// StartupTask del manifest); en canal directo Windows lee el registro `Run` con el
/// predicado de `auto-launch` 0.5.0. En cualquier otro SO delega en el plugin
/// (`enabled`/`disabled`/`unknown`, mecanismo `plugin`) tal como hacía `get_device_profile`
/// antes de este módulo.
pub async fn current<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> AutostartSnapshot {
    if crate::utils::is_running_under_package_identity() {
        // "unsupported" solo puede pasar aquí si `is_running_under_package_identity`
        // (WinRT) y `startup_task_get_state` (también WinRT) discreparan; no debería
        // ocurrir, pero cae a "unknown" en vez de propagar un estado sin sentido.
        let state = match crate::startup_task::startup_task_get_state().await {
            Ok(state) if state != "unsupported" => state,
            _ => "unknown".to_string(),
        };
        return AutostartSnapshot {
            state,
            disabled_at: None,
            mechanism: "startup_task",
        };
    }

    #[cfg(target_os = "windows")]
    {
        classify_direct()
    }
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let state = match _app.autolaunch().is_enabled() {
            Ok(true) => "enabled",
            Ok(false) => "disabled",
            Err(_) => "unknown",
        };
        AutostartSnapshot {
            state: state.to_string(),
            disabled_at: None,
            mechanism: "plugin",
        }
    }
}

/// Comando invocable: estado de autostart de este canal/proceso (`AutostartSnapshot`).
#[tauri::command]
pub async fn autostart_get_state<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AutostartSnapshot {
    current(&app).await
}

#[cfg(target_os = "windows")]
fn classify_direct() -> AutostartSnapshot {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let run_present = hkcu
        .open_subkey_with_flags(RUN_REGKEY, KEY_READ)
        .ok()
        .and_then(|k| k.get_value::<String, _>(AUTOSTART_VALUE_NAME).ok())
        .is_some();

    let task_manager_override = hkcu
        .open_subkey_with_flags(TASK_MANAGER_OVERRIDE_REGKEY, KEY_READ)
        .ok()
        .and_then(|k| k.get_raw_value(AUTOSTART_VALUE_NAME).ok())
        .map(|v| v.bytes.into_owned());

    classify_from_registry_snapshot(run_present, task_manager_override)
}

/// Pura (sin registro): decide `disabled | enabled | disabledByUser` a partir de si el
/// valor `Run` está presente y, si lo está, de la cola cruda de `StartupApproved\Run`.
/// Sin `Run` manda "disabled" aunque la cola de Task Manager diga lo contrario (bytes
/// residuales de una instalación anterior) — por eso este chequeo va ANTES de mirar la
/// cola, no como un short-circuit fuera de la función pura. Testeable sin Windows.
fn classify_from_registry_snapshot(
    run_present: bool,
    task_manager_override: Option<Vec<u8>>,
) -> AutostartSnapshot {
    if !run_present {
        return AutostartSnapshot {
            state: "disabled".to_string(),
            disabled_at: None,
            mechanism: "run_key",
        };
    }

    classify_from_task_manager_override(task_manager_override)
}

/// Pura (sin registro): decide `enabled` vs `disabledByUser` a partir de la cola cruda de
/// `StartupApproved\Run`, ya con el valor `Run` confirmado presente. Testeable sin Windows.
fn classify_from_task_manager_override(bytes: Option<Vec<u8>>) -> AutostartSnapshot {
    let mechanism = "run_key";
    let bytes = match bytes {
        Some(b) => b,
        // Sin la clave de override, o sin valor para este app_name: auto-launch trata
        // esto como "no hay veto de Task Manager" ⇒ enabled.
        None => {
            return AutostartSnapshot {
                state: "enabled".to_string(),
                disabled_at: None,
                mechanism,
            }
        }
    };

    if bytes.len() < 8 || last_eight_bytes_all_zero(&bytes) {
        return AutostartSnapshot {
            state: "enabled".to_string(),
            disabled_at: None,
            mechanism,
        };
    }

    let disabled_at = bytes
        .get(4..12)
        .and_then(|slice| <[u8; 8]>::try_from(slice).ok())
        .map(u64::from_le_bytes)
        .and_then(crate::utils::filetime_ticks_to_rfc3339);

    AutostartSnapshot {
        state: "disabledByUser".to_string(),
        disabled_at,
        mechanism,
    }
}

fn last_eight_bytes_all_zero(bytes: &[u8]) -> bool {
    bytes.iter().rev().take(8).all(|b| *b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_run_manda_disabled_aunque_la_cola_de_task_manager_diga_apagado() {
        // Tabla del plan (#83 P1a): (run_present=false, Some(cola no-cero)) ⇒
        // ("disabled", None) — sin el valor `Run`, la cola residual de
        // StartupApproved\Run (de una instalación anterior) no debe leerse.
        let ticks: u64 = 133_485_408_000_000_000;
        let mut bytes = vec![0x03, 0x00, 0x00, 0x00];
        bytes.extend_from_slice(&ticks.to_le_bytes());
        let snap = classify_from_registry_snapshot(false, Some(bytes));
        assert_eq!(snap.state, "disabled");
        assert_eq!(snap.disabled_at, None);
        assert_eq!(snap.mechanism, "run_key");
    }

    #[test]
    fn sin_run_manda_disabled_sin_cola_de_task_manager() {
        let snap = classify_from_registry_snapshot(false, None);
        assert_eq!(snap.state, "disabled");
        assert_eq!(snap.disabled_at, None);
    }

    #[test]
    fn con_run_delega_en_la_cola_de_task_manager() {
        let snap = classify_from_registry_snapshot(true, None);
        assert_eq!(snap.state, "enabled");
    }

    #[test]
    fn sin_cola_de_task_manager_es_enabled() {
        let snap = classify_from_task_manager_override(None);
        assert_eq!(snap.state, "enabled");
        assert_eq!(snap.disabled_at, None);
        assert_eq!(snap.mechanism, "run_key");
    }

    #[test]
    fn cola_corta_es_enabled() {
        let snap = classify_from_task_manager_override(Some(vec![0x02, 0x00, 0x00]));
        assert_eq!(snap.state, "enabled");
        assert_eq!(snap.disabled_at, None);
    }

    #[test]
    fn cola_con_ultimos_ocho_bytes_en_cero_es_enabled() {
        // El literal exacto que `auto-launch::enable()` escribe.
        let snap = classify_from_task_manager_override(Some(vec![
            0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]));
        assert_eq!(snap.state, "enabled");
        assert_eq!(snap.disabled_at, None);
    }

    #[test]
    fn cola_con_timestamp_no_cero_es_disabled_by_user_con_fecha() {
        // FILETIME de 2024-01-01T00:00:00Z en little-endian, bytes 4..12.
        let ticks: u64 = 133_485_408_000_000_000;
        let mut bytes = vec![0x03, 0x00, 0x00, 0x00];
        bytes.extend_from_slice(&ticks.to_le_bytes());
        let snap = classify_from_task_manager_override(Some(bytes));
        assert_eq!(snap.state, "disabledByUser");
        assert_eq!(snap.mechanism, "run_key");
        assert_eq!(
            snap.disabled_at.as_deref(),
            Some("2024-01-01T00:00:00+00:00")
        );
    }

    #[test]
    fn cola_no_cero_pero_fuera_de_rango_cae_a_disabled_at_none() {
        // Últimos 8 bytes no-cero pero < época FILETIME->Unix: `filetime_ticks_to_rfc3339`
        // devuelve `None`; el estado sigue siendo disabledByUser (sí hay veto).
        let mut bytes = vec![0x03, 0x00, 0x00, 0x00];
        bytes.extend_from_slice(&1u64.to_le_bytes());
        let snap = classify_from_task_manager_override(Some(bytes));
        assert_eq!(snap.state, "disabledByUser");
        assert_eq!(snap.disabled_at, None);
    }

    #[test]
    fn last_eight_bytes_all_zero_funciona_con_relleno_extra() {
        assert!(last_eight_bytes_all_zero(&[
            0x09, 0x09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ]));
        assert!(!last_eight_bytes_all_zero(&[
            0x09, 0x09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01
        ]));
    }
}
