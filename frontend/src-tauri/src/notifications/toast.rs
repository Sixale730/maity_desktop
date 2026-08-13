//! Transporte ÚNICO de notificaciones nativas del OS.
//!
//! # Por qué existe
//!
//! `tauri-plugin-notification` es INUTILIZABLE bajo identidad de paquete (MSIX/Store). Su
//! `NotificationBuilder::show()` (`desktop.rs`) hace:
//!
//! ```ignore
//! #[cfg(windows)] {
//!     // fija el app_id salvo que el exe viva en target\{debug,release}
//!     if !(curr_dir.ends_with("\\target\\debug") || curr_dir.ends_with("\\target\\release")) {
//!         notification.app_id(&self.identifier);   // = config.identifier = "com.maity.ai"
//!     }
//! }
//! tauri::async_runtime::spawn(async move { let _ = notification.show(); });  // ← error TRAGADO
//! ```
//!
//! Eso baja a `Toast::new(app_id).show()` → `CreateToastNotifierWithId(app_id)`. Bajo MSIX el
//! proceso tiene identidad de paquete y su AUMID real es `Sixale.Maity_q5b9hqhck1xz0!Maity`;
//! `com.maity.ai` es un AUMID ajeno y Windows rechaza el toast. Y el error se traga DOS veces
//! (el `let _ =` de arriba, y `sendNotification()` de JS que es síncrona y no devuelve la
//! promesa del invoke), así que el síntoma era: log en verde, cero toast, y ni siquiera el
//! fallback a toast in-app.
//!
//! Aquí llamamos a `tauri-winrt-notification` directo (la MISMA crate y versión que el plugin
//! usa por dentro), resolvemos el `app_id` EN RUNTIME y devolvemos un `Result` real.
//!
//! # Regla
//!
//! Toda notificación nativa nueva debe pasar por aquí (o por el comando
//! `send_native_notification` desde el frontend). NUNCA usar `@tauri-apps/plugin-notification`
//! ni `app.notification().builder()` directo: funcionan en NSIS y fallan mudos en la Store.

use tauri::{AppHandle, Runtime};

/// Cómo se resolvió el `app_id` del toast en este proceso. Solo diagnóstico: lo loguea el
/// `setup()` de `lib.rs` y lo expone el comando `native_notification_target` (que alimenta el
/// botón "Probar" de Ajustes → Notificaciones, único vector de diagnóstico en un build release
/// de la Store, donde no hay devtools).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastTarget {
    /// `true` si el proceso corre bajo identidad de paquete (MSIX/Store).
    pub packaged: bool,
    /// AUMID/app_id efectivo que recibe `CreateToastNotifierWithId`.
    pub app_id: String,
    /// `"packaged"` | `"dev"` | `"unpackaged"` | `"n/a"` (plataformas no-Windows).
    pub mode: &'static str,
}

/// Resuelve el `app_id` del toast para este proceso.
///
/// El ORDEN de las ramas importa: el check de identidad de paquete va PRIMERO porque
/// `crate::utils::current_aumid()` devuelve un FALLBACK hardcodeado cuando la API falla, y ese
/// literal como `app_id` de un proceso sin empaquetar reproduciría el bug en espejo.
#[allow(unused_variables)]
pub fn resolve_target<R: Runtime>(app: &AppHandle<R>) -> ToastTarget {
    #[cfg(target_os = "windows")]
    {
        use tauri_winrt_notification::Toast;

        if crate::utils::is_running_under_package_identity() {
            return ToastTarget {
                packaged: true,
                app_id: crate::utils::current_aumid(),
                mode: "packaged",
            };
        }

        // Espeja la heurística de `tauri-plugin-notification` (desktop.rs): un binario que
        // corre desde `target\{debug,release}` no tiene acceso directo registrado, así que
        // `com.maity.ai` sería un AUMID inexistente y el toast no saldría. El plugin cae al
        // AUMID de PowerShell en ese caso; hacemos lo mismo.
        //
        // `tauri::is_dev()` solo NO basta: `tauri build --debug` (el build obligatorio del
        // repo) produce un binario no-dev que igual corre desde `target\debug` — sin esta
        // rama el smoke test de ese build no mostraría nada y parecería una regresión.
        let from_target_dir = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
            .map(|dir| {
                let s = dir.to_string_lossy().to_string();
                s.ends_with("\\target\\debug") || s.ends_with("\\target\\release")
            })
            .unwrap_or(false);

        if tauri::is_dev() || from_target_dir {
            return ToastTarget {
                packaged: false,
                app_id: Toast::POWERSHELL_APP_ID.to_string(),
                mode: "dev",
            };
        }

        // Instalación NSIS: el instalador registra el acceso directo con este AUMID.
        ToastTarget {
            packaged: false,
            app_id: app.config().identifier.clone(),
            mode: "unpackaged",
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        ToastTarget {
            packaged: false,
            app_id: app.config().identifier.clone(),
            mode: "n/a",
        }
    }
}

/// Muestra un toast nativo del sistema.
///
/// Devuelve `Err` si el OS lo rechazó, para que el caller (el frontend vía
/// `send_native_notification`, o `system.rs`) pueda caer a un toast in-app. NUNCA se traga el
/// error: ese era exactamente el bug.
pub fn show_native_toast<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let target = resolve_target(app);

    #[cfg(target_os = "windows")]
    {
        use tauri_winrt_notification::{Duration, Sound, Toast};

        Toast::new(&target.app_id)
            .title(title)
            .text1(body)
            // `Some(Sound::Default)` emite cadena VACÍA (sin elemento `<audio>`) → Windows
            // reproduce su sonido de notificación por defecto. Es una DECISIÓN de producto
            // (ago-2026), no un descuido: antes se pasaba `None`, que emite
            // `<audio silent="true"/>` y replicaba el mudo histórico de notify-rust. Aplica a
            // AMBOS canales — NSIS también suena, que es lo buscado.
            .sound(Some(Sound::Default))
            // `Timeout::Default` de notify-rust mapea a `Duration::Short`.
            .duration(Duration::Short)
            // Sin `.icon()`/`.image()`, igual que hoy: Windows usa el icono registrado del
            // AUMID (bajo MSIX, el `Square44x44Logo` del manifest). Un path explícito tendría
            // que sobrevivir la virtualización del paquete.
            .show()
            .map_err(|e| {
                format!(
                    "Windows rechazó el toast (app_id={}, mode={}): {}",
                    target.app_id, target.mode, e
                )
            })
    }
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;

        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| format!("plugin de notificaciones: {}", e))
    }
}
