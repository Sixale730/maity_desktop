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
use std::sync::Mutex;

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

// ── `autostart.changed` contra la línea base del marcador (#83 P2, AC-16) ──
//
// La línea base ("último estado visto") vive en `lifecycle.json`
// (`last_autostart_state`, §1.5 del contrato) y se arrastra entre arranques.
// `reconcile` la compara contra el estado real de ESTE momento y, si cambió,
// emite `autostart.changed` y avanza la línea base — pero SOLO si la fila
// quedó en el outbox (si `emit_event_with_id` no consigue insertarla, se
// revierte el swap para reintentar en el próximo reconcile). Sin previo
// (primer arranque, o el marcador aún no tenía el campo) NO se emite nada:
// solo se fija la línea base.
//
// `RECONCILE_LOCK` serializa la sección síncrona (leer+swap la línea base)
// entre los tres disparadores (`boot`, `settings_toggle`, `bootstrap`), que
// en la práctica nunca corren en paralelo entre sí, pero el candado evita que
// dos reconcile solapados pisen el swap del otro. El lock NUNCA se sostiene
// a través de un `.await` (un `std::sync::MutexGuard` no es `Send`).
static RECONCILE_LOCK: Mutex<()> = Mutex::new(());

/// Pura (sin I/O): decide qué hacer al comparar la línea base persistida
/// (`prev`, `None` = sin marcador todavía) contra el estado real actual.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReconcileDecision {
    /// Sin línea base previa (primer arranque, o instalación nueva): solo se
    /// fija, nunca se emite (evitaría un `autostart.changed` fantasma con
    /// `from: null` en cada instalación).
    BaselineOnly,
    /// El estado no cambió respecto a la línea base: nada que hacer.
    Unchanged,
    /// El estado cambió: hay que emitir `autostart.changed` con este `from`.
    Changed { from: String },
}

pub(crate) fn decide_change(prev: Option<&str>, current_state: &str) -> ReconcileDecision {
    match prev {
        None => ReconcileDecision::BaselineOnly,
        Some(p) if p == current_state => ReconcileDecision::Unchanged,
        Some(p) => ReconcileDecision::Changed { from: p.to_string() },
    }
}

/// Compara el estado real del autostart contra la línea base y, si cambió,
/// emite `autostart.changed`. Lee el estado actual con `current(app)` (un
/// registro más en canal directo); usa `reconcile_with` cuando el llamador ya
/// tiene el `AutostartSnapshot` a mano (p. ej. `lifecycle::emit_start`, que lo
/// necesita también para `app.start.autostart_state`).
pub async fn reconcile<R: tauri::Runtime>(app: &tauri::AppHandle<R>, trigger: &'static str) {
    let snapshot = current(app).await;
    reconcile_with(app, trigger, snapshot).await;
}

pub(crate) async fn reconcile_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    trigger: &'static str,
    snapshot: AutostartSnapshot,
) {
    // Un fallo transitorio de lectura (WinRT discrepante bajo MSIX, o el plugin
    // devolviendo Err en macOS/Linux) no debe tocar la línea base: produciría un
    // ciclo `enabled→unknown→enabled` con dos eventos `autostart.changed` falsos
    // (plan.md P2, paso b). Salir sin swap ni emit.
    if snapshot.state == "unknown" {
        return;
    }

    let decision = {
        let _guard = RECONCILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = crate::logging::telemetry::lifecycle::swap_last_autostart_state(&snapshot.state);
        decide_change(prev.as_deref(), &snapshot.state)
    };

    let from = match decision {
        ReconcileDecision::BaselineOnly | ReconcileDecision::Unchanged => return,
        ReconcileDecision::Changed { from } => from,
    };

    let payload = serde_json::json!({
        "from": from,
        "to": snapshot.state,
        "trigger": trigger,
        "mechanism": snapshot.mechanism,
        "disabled_at": snapshot.disabled_at,
    });
    let session_id = crate::logging::telemetry::context::process_session_id();
    let id = crate::logging::telemetry::emit::emit_event_with_id(
        app,
        session_id,
        crate::logging::telemetry::catalog::AUTOSTART_CHANGED,
        payload,
        Some(crate::logging::telemetry::status::TelemetryStatus::Ok),
        None,
        None,
    )
    .await;

    if id.is_none() {
        // La fila no quedó en el outbox (sin AppState o error de escritura):
        // revertir la línea base para que el próximo reconcile vuelva a ver
        // el cambio pendiente.
        let _guard = RECONCILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        crate::logging::telemetry::lifecycle::swap_last_autostart_state(&from);
    }
}

/// Comando invocable desde JS: dispara `reconcile` para los disparadores que
/// NO son `boot` (ese lo llama `lifecycle::emit_start` internamente).
/// Allowlist explícita — `settings_toggle` (PreferenceSettings, tras cada
/// toggle exitoso) y `bootstrap` (`useAutostartBootstrap`, tras `enable()`).
#[tauri::command]
pub async fn autostart_reconcile<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    trigger: String,
) -> Result<(), String> {
    let trigger: &'static str = match trigger.as_str() {
        "settings_toggle" => "settings_toggle",
        "bootstrap" => "bootstrap",
        other => return Err(format!("trigger de autostart_reconcile no permitido: {other}")),
    };
    reconcile(&app, trigger).await;
    Ok(())
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
    fn decide_change_sin_linea_base_solo_fija() {
        assert_eq!(decide_change(None, "enabled"), ReconcileDecision::BaselineOnly);
    }

    #[test]
    fn decide_change_igual_a_la_linea_base_no_hace_nada() {
        assert_eq!(
            decide_change(Some("enabled"), "enabled"),
            ReconcileDecision::Unchanged
        );
    }

    #[test]
    fn decide_change_distinto_de_la_linea_base_emite_con_el_from_correcto() {
        assert_eq!(
            decide_change(Some("enabled"), "disabledByUser"),
            ReconcileDecision::Changed {
                from: "enabled".to_string()
            }
        );
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
