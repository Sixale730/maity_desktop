//! Actualizaciones del canal Microsoft Store (MSIX) vía la API oficial
//! `Windows.Services.Store.StoreContext`.
//!
//! Antes el aviso comparaba contra `maity.system_config['desktop_store_latest_version']`,
//! una fila que alguien debía bumpear a mano al publicar — y se olvidó de 0.2.58 a
//! 0.2.61 (incidente 2026-09-22: ningún usuario Store vio el aviso). Aquí la Store
//! misma dice si hay update para ESTA instalación, y puede instalarlo con su propio
//! diálogo de permiso. La fila queda como respaldo en `updateService.ts` si esto falla.
//!
//! - App de escritorio (Desktop Bridge): el `StoreContext` DEBE ligarse a la ventana
//!   dueña con `IInitializeWithWindow`, o los diálogos de la Store no tienen owner.
//! - Los `.get()` bloquean: corren en `startup_task::with_mta` (spawn_blocking + MTA),
//!   nunca en el hilo STA de wry.
//! - Sólo funciona con el paquete instalado DESDE la Store (`SignatureKind: Store`).
//!   Un MSIX de prueba (`Developer`) no tiene updates que la Store le sirva.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoreUpdateCheck {
    pub available: bool,
    /// `Major.Minor.Build` del paquete nuevo (el 4º dígito del MSIX siempre es 0).
    pub version: Option<String>,
    pub mandatory: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum StoreInstallOutcome {
    /// Instalado. Normalmente Windows cierra la app antes de que esto llegue al frontend.
    Completed,
    /// El usuario rechazó el diálogo de la Store.
    Canceled,
    /// La Store ya no reporta updates (p. ej. se aplicó en segundo plano).
    NoUpdates,
    /// Hay una grabación en curso: no se arranca una instalación que cerraría la app.
    RecordingActive,
    Error(String),
}

/// Traduce el `StorePackageUpdateState` final (su valor i32) al resultado del comando.
/// Pura para poder testearla sin WinRT. Valores de `Windows.Services.Store.StorePackageUpdateState`.
pub fn map_outcome(state: i32) -> StoreInstallOutcome {
    match state {
        3 => StoreInstallOutcome::Completed,
        4 => StoreInstallOutcome::Canceled,
        6 => StoreInstallOutcome::Error("batería baja".into()),
        7 => StoreInstallOutcome::Error("la Store recomienda Wi-Fi".into()),
        8 => StoreInstallOutcome::Error("la Store requiere Wi-Fi".into()),
        0..=2 => StoreInstallOutcome::Error(format!("la instalación quedó incompleta (estado {state})")),
        other => StoreInstallOutcome::Error(format!("error de la Store (estado {other})")),
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use tauri::{AppHandle, Manager};
    use windows::core::Interface;
    use windows::Services::Store::{StoreContext, StorePackageUpdate};
    use windows::Foundation::Collections::IVectorView;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IInitializeWithWindow;

    /// HWND de la ventana principal como entero (los punteros crudos no son `Send`).
    pub fn main_hwnd(app: &AppHandle) -> Result<isize, String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "ventana main no disponible".to_string())?;
        // tauri devuelve el HWND de windows 0.61; el de esta app es 0.58 — mismo layout.
        let hwnd = window.hwnd().map_err(|e| format!("hwnd() falló: {e}"))?;
        Ok(hwnd.0 as isize)
    }

    pub fn store_context(hwnd: isize) -> Result<StoreContext, String> {
        let ctx = StoreContext::GetDefault().map_err(|e| format!("StoreContext::GetDefault falló: {e}"))?;
        let init: IInitializeWithWindow = ctx
            .cast()
            .map_err(|e| format!("StoreContext sin IInitializeWithWindow: {e}"))?;
        unsafe { init.Initialize(HWND(hwnd as *mut core::ffi::c_void)) }
            .map_err(|e| format!("IInitializeWithWindow::Initialize falló: {e}"))?;
        Ok(ctx)
    }

    pub fn pending_updates(ctx: &StoreContext) -> Result<IVectorView<StorePackageUpdate>, String> {
        ctx.GetAppAndOptionalStorePackageUpdatesAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("GetAppAndOptionalStorePackageUpdatesAsync falló: {e}"))
    }

    pub fn summarize(updates: &IVectorView<StorePackageUpdate>) -> Result<StoreUpdateCheck, String> {
        let count = updates.Size().map_err(|e| format!("Size() falló: {e}"))?;
        if count == 0 {
            return Ok(StoreUpdateCheck { available: false, version: None, mandatory: false });
        }
        let mut version = None;
        let mut mandatory = false;
        for update in updates {
            mandatory |= update.Mandatory().unwrap_or(false);
            if version.is_none() {
                // La versión es informativa (texto del diálogo): si falla, se avisa igual.
                version = update
                    .Package()
                    .and_then(|p| p.Id())
                    .and_then(|id| id.Version())
                    .ok()
                    .map(|v| format!("{}.{}.{}", v.Major, v.Minor, v.Build));
            }
        }
        Ok(StoreUpdateCheck { available: true, version, mandatory })
    }

    pub fn install(ctx: &StoreContext, updates: &IVectorView<StorePackageUpdate>) -> Result<StoreInstallOutcome, String> {
        let result = ctx
            .RequestDownloadAndInstallStorePackageUpdatesAsync(updates)
            .and_then(|op| op.get())
            .map_err(|e| format!("RequestDownloadAndInstallStorePackageUpdatesAsync falló: {e}"))?;
        let state = result
            .OverallState()
            .map_err(|e| format!("OverallState() falló: {e}"))?;
        Ok(map_outcome(state.0))
    }
}

/// ¿La Store tiene una versión nueva de Maity para esta instalación?
/// `Err("unsupported")` fuera de MSIX: el frontend sigue por su ruta de siempre.
#[tauri::command]
pub async fn store_check_updates(app: tauri::AppHandle) -> Result<StoreUpdateCheck, String> {
    #[cfg(target_os = "windows")]
    {
        if !crate::utils::is_running_under_package_identity() {
            return Err("unsupported".into());
        }
        let hwnd = imp::main_hwnd(&app)?;
        let check = crate::startup_task::with_mta(move || {
            let ctx = imp::store_context(hwnd)?;
            let updates = imp::pending_updates(&ctx)?;
            imp::summarize(&updates)
        })
        .await;
        match &check {
            Ok(c) => log::info!("[store_update] check: {:?}", c),
            Err(e) => log::warn!("[store_update] check falló: {e}"),
        }
        check
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

/// Descarga e instala el update con el diálogo nativo de la Store. Si se completa,
/// Windows cierra Maity para aplicar el paquete. Se niega con una grabación en curso.
#[tauri::command]
pub async fn store_install_updates(app: tauri::AppHandle) -> Result<StoreInstallOutcome, String> {
    #[cfg(target_os = "windows")]
    {
        if !crate::utils::is_running_under_package_identity() {
            return Err("unsupported".into());
        }
        if crate::audio::recording_commands::is_recording().await {
            log::warn!("[store_update] install rechazado: grabación en curso");
            return Ok(StoreInstallOutcome::RecordingActive);
        }
        let hwnd = imp::main_hwnd(&app)?;
        let outcome = crate::startup_task::with_mta(move || {
            let ctx = imp::store_context(hwnd)?;
            let updates = imp::pending_updates(&ctx)?;
            if updates.Size().unwrap_or(0) == 0 {
                return Ok(StoreInstallOutcome::NoUpdates);
            }
            imp::install(&ctx, &updates)
        })
        .await;
        match &outcome {
            Ok(o) => log::info!("[store_update] install: {:?}", o),
            Err(e) => log::warn!("[store_update] install falló: {e}"),
        }
        outcome
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_y_canceled_se_distinguen_de_los_errores() {
        assert_eq!(map_outcome(3), StoreInstallOutcome::Completed);
        assert_eq!(map_outcome(4), StoreInstallOutcome::Canceled);
    }

    #[test]
    fn estados_de_error_y_no_terminales_son_error() {
        for state in [0, 1, 2, 5, 6, 7, 8, 99] {
            assert!(
                matches!(map_outcome(state), StoreInstallOutcome::Error(_)),
                "estado {state} debería ser Error"
            );
        }
    }

    #[test]
    fn outcome_serializa_con_kind_en_camel_case() {
        let json = serde_json::to_value(StoreInstallOutcome::RecordingActive).unwrap();
        assert_eq!(json["kind"], "recordingActive");
        let json = serde_json::to_value(StoreInstallOutcome::Error("x".into())).unwrap();
        assert_eq!(json["kind"], "error");
        assert_eq!(json["detail"], "x");
    }
}
