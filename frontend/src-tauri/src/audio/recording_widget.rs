//! Widget flotante de grabación siempre visible (always-on-top).
//!
//! Mini-ventana Tauri secundaria que muestra controles de grabación encima
//! de cualquier otra app (Zoom/Teams/Meet). Replica el patrón de `coach-float`
//! pero específicamente para el botón "Grabar" + niveles + pausa/stop.
//!
//! Estados:
//! - Colapsado: 310x48 (idle [▶ Grabar] o grabando 🔴 mm:ss [⏸][⏹])
//! - Expandido: 320x340 (estilo glass coach-float con timer grande + niveles
//!   prominentes + controles)
//!
//! La preferencia de visibilidad se persiste en `widget-preferences.json`
//! vía tauri_plugin_store, mismo patrón que `onboarding-status.json`.

use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Size};
use tauri_plugin_store::StoreExt;
use tracing::{info, warn};

const WIDGET_LABEL: &str = "recording-widget";
const MAIN_LABEL: &str = "main";
const VISIBILITY_EVENT: &str = "recording-widget-visibility-changed";
const REQUEST_START_EVENT: &str = "widget-request-start-recording";
const PREFS_FILE: &str = "widget-preferences.json";
const PREF_KEY_VISIBLE: &str = "recording_widget_visible";

// Colapsado más ancho (310) para que quepan los botones inline de Grabar /
// Pausa / Stop sin tener que expandir. Antes 170 solo cabía dot + texto.
const COLLAPSED_W: f64 = 310.0;
const COLLAPSED_H: f64 = 48.0;
// Expandido más alto (320×340) para layout vertical estilo coach-float:
// header + timer grande + niveles prominentes + controles. Antes 280×200
// quedaba muy chico para que se notara la grabación activa.
const EXPANDED_W: f64 = 320.0;
const EXPANDED_H: f64 = 340.0;
// Margen amplio para alejar el widget del reloj/taskbar de Windows.
const MARGIN_X: f64 = 80.0;
const MARGIN_Y: f64 = 110.0;

/// Abre la ventana flotante del widget de grabación. Si ya existe, la enfoca
/// y la re-posiciona a la esquina inferior derecha (útil cuando cambian los
/// márgenes default tras un update y la ventana queda en una posición vieja).
#[tauri::command]
pub async fn open_recording_widget<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WIDGET_LABEL) {
        w.show().map_err(|e| e.to_string())?;
        position_to_default_corner(&w);
        w.set_focus().map_err(|e| e.to_string())?;
        emit_visibility(&app, true);
        return Ok(());
    }

    // Patrón glass igual a coach-float: transparent + decorations=false +
    // skip_taskbar=false (para que el usuario lo encuentre en alt-tab si se
    // pierde). El root React aplica el rgba(15,16,24,0.92) + backdrop-blur.
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        WIDGET_LABEL,
        tauri::WebviewUrl::App("recording-widget".into()),
    )
    .title("Maity Recording")
    .inner_size(COLLAPSED_W, COLLAPSED_H)
    .min_inner_size(COLLAPSED_W, COLLAPSED_H)
    .always_on_top(true)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(false)
    .transparent(true)
    .build()
    .map_err(|e| format!("Error abriendo widget de grabación: {}", e))?;

    position_to_default_corner(&window);

    emit_visibility(&app, true);
    info!("✅ Recording widget abierto");
    Ok(())
}

/// Coloca la ventana en la esquina inferior derecha del monitor primario con
/// los márgenes definidos arriba (separado de la creación para reusar al
/// reabrir la ventana existente).
fn position_to_default_corner<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let mon_w = size.width as f64 / scale;
        let mon_h = size.height as f64 / scale;
        // Usa el tamaño lógico actual (puede estar colapsado o expandido).
        let (w_logical, h_logical) = match window.inner_size() {
            Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
            Err(_) => (COLLAPSED_W, COLLAPSED_H),
        };
        let target_x = (mon_w - w_logical - MARGIN_X).max(0.0);
        let target_y = (mon_h - h_logical - MARGIN_Y).max(0.0);
        if let Err(e) = window.set_position(LogicalPosition::new(target_x, target_y)) {
            warn!("No se pudo posicionar widget de grabación: {}", e);
        }
    }
}

/// Cierra la ventana flotante del widget.
#[tauri::command]
pub async fn close_recording_widget<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WIDGET_LABEL) {
        w.close().map_err(|e| e.to_string())?;
        emit_visibility(&app, false);
    }
    Ok(())
}

/// Cambia el tamaño del widget entre colapsado y expandido. El frontend invoca
/// esto al click en el botón de expand/collapse, sincronizado con su isExpanded.
#[tauri::command]
pub async fn recording_widget_set_size<R: Runtime>(
    app: AppHandle<R>,
    expanded: bool,
) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WIDGET_LABEL) {
        let (width, height) = if expanded {
            (EXPANDED_W, EXPANDED_H)
        } else {
            (COLLAPSED_W, COLLAPSED_H)
        };
        w.set_size(Size::Logical(LogicalSize { width, height }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lee la preferencia de visibilidad del widget. Default: true (visible).
#[tauri::command]
pub async fn recording_widget_get_visibility_pref<R: Runtime>(app: AppHandle<R>) -> bool {
    load_visibility_pref(&app).unwrap_or(true)
}

/// Guarda la preferencia de visibilidad y, si cambia, abre o cierra la ventana.
#[tauri::command]
pub async fn recording_widget_set_visibility_pref<R: Runtime>(
    app: AppHandle<R>,
    visible: bool,
) -> Result<(), String> {
    save_visibility_pref(&app, visible)?;
    if visible {
        open_recording_widget(app).await?;
    } else {
        close_recording_widget(app).await?;
    }
    Ok(())
}

/// Devuelve si la ventana del widget está actualmente abierta. Usado por el
/// FAB en main window para decidir si mostrarse o no al montar.
#[tauri::command]
pub async fn is_recording_widget_open<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window(WIDGET_LABEL).is_some()
}

/// Wrapper para stop_recording: genera el save_path internamente para que el
/// frontend del widget no necesite conocer `app_data_dir`. Mismo patrón que el
/// handler `stop_recording_handler` del tray (tray.rs:196-244).
///
/// SNAPSHOT del estado minimizado de la main window (US-4): si el usuario apretó Stop con
/// la ventana minimizada (apertura por autostart o minimización manual durante grabación),
/// seteamos `KEEP_MAIN_MINIMIZED_AFTER_STOP=true`. El `useRecordingStop` del frontend hace
/// `window.location.href = '/conversations?...'` que en Chromium/Tauri trae la ventana al
/// frente automáticamente — el `on_window_event` handler en lib.rs detecta el `Focused(true)`
/// resultante y re-minimiza, preservando el patrón Steam.
#[tauri::command]
pub async fn stop_recording_from_widget<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // Snapshot ANTES del stop: el flag debe estar listo para cuando dispare el hard navigate.
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let was_minimized = main.is_minimized().unwrap_or(false);
        crate::KEEP_MAIN_MINIMIZED_AFTER_STOP.store(was_minimized, Ordering::Relaxed);
        if was_minimized {
            info!("Widget stop: main estaba minimizada, flag set para re-minimize post-navigate");
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let save_path = data_dir.join(format!("recording-{}.wav", timestamp));

    let stop_result = crate::audio::recording_commands::stop_recording(
        app.clone(),
        crate::audio::recording_commands::RecordingArgs {
            save_path: save_path.to_string_lossy().to_string(),
        },
    )
    .await;

    match stop_result {
        Ok(_) => {
            info!("✅ Recording stopped from widget");
            // Notificar al frontend principal para que dispare post-procesamiento
            // (SQLite save, navigation, analytics). Mismo evento que el tray.
            if let Err(e) = app.emit("recording-stop-complete", true) {
                warn!("Widget: failed to emit recording-stop-complete: {}", e);
            }
            Ok(())
        }
        Err(e) => Err(format!("Failed to stop recording from widget: {}", e)),
    }
}

/// Solicita al frontend principal que inicie la grabación reusando el flujo canónico de
/// `useRecordingStart` (validación de Deepgram proxy, Parakeet ready, contextos React,
/// analytics, etc.). Emite directamente el evento sin tocar la visibilidad de la main
/// window — el `RecordingWidgetListener` sigue activo aunque la ventana esté minimizada
/// gracias a las flags Chromium `--disable-renderer-backgrounding` configuradas en
/// `tauri.conf.json` (US-3 del plan autostart).
///
/// El widget muestra `busy` mientras espera el evento `recording-start-complete` que
/// cierra el loop. Si no llega en 5s, el widget muestra error inline.
///
/// HISTORIA: este comando solía hacer `unminimize+show+set_focus+sleep(150ms)` para
/// despertar el webview suspendido por Chromium. Las flags Chromium eliminan la suspensión,
/// así que el wake-up dance se removió — la main permanece minimizada mientras el usuario
/// graba, preservando su foco visual sobre Zoom/Teams/Meet.
#[tauri::command]
pub async fn recording_widget_request_start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.emit(REQUEST_START_EVENT, ())
        .map_err(|e| format!("Failed to emit widget-request-start-recording: {}", e))?;
    info!("📡 Widget solicitó iniciar grabación al main (sin alterar visibilidad)");
    Ok(())
}

// ─── Helpers de persistencia ─────────────────────────────────────────────────

fn load_visibility_pref<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let store = app.store(PREFS_FILE).ok()?;
    let value = store.get(PREF_KEY_VISIBLE)?;
    value.as_bool()
}

fn save_visibility_pref<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    let store = app
        .store(PREFS_FILE)
        .map_err(|e| format!("Failed to access widget preferences store: {}", e))?;
    store.set(PREF_KEY_VISIBLE, serde_json::Value::Bool(visible));
    store
        .save()
        .map_err(|e| format!("Failed to persist widget preferences: {}", e))?;
    Ok(())
}

/// Emite el evento de cambio de visibilidad al resto de la app. El FAB de la
/// main window lo escucha para mostrarse/ocultarse, y el toggle de Settings
/// puede reaccionar al cambio si lo hicieron desde otro origen (tray, X).
fn emit_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Err(e) = app.emit(VISIBILITY_EVENT, serde_json::json!({ "visible": visible })) {
        warn!("Failed to emit {}: {}", VISIBILITY_EVENT, e);
    }
}

/// Helper interno que el `setup` de lib.rs llama al inicio para decidir si
/// abrir el widget automáticamente según la preferencia guardada.
pub fn should_auto_open<R: Runtime>(app: &AppHandle<R>) -> bool {
    load_visibility_pref(app).unwrap_or(true)
}
