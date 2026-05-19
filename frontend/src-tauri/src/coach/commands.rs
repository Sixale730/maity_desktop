//! Comandos Tauri del coach: sugerencias, configuración de modelos,
//! estado del motor LLM local (sidecar Built-in AI), y ventana flotante always-on-top.

use crate::coach::evaluator::evaluate_meeting;
use crate::coach::live_feedback::CoachTipUpdate;
use crate::coach::llama_engine;
use crate::coach::llm_helper::build_coach_service_with_model;
use crate::coach::model_registry;
use crate::coach::prompt::DEFAULT_CHAT_MODEL;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use tracing::{info, warn};

// Constantes del coach-float como única ventana flotante de la app.
// Iter 11: ahora son DOS estados (barra sola | barra + drawer panel), no tres.
// La barra superior es siempre constante (76 px); el drawer se despliega
// debajo sumando ~260 px para health/tips/talk-split.
const COACH_FLOAT_LABEL: &str = "coach-float";
// Modo barra-sola (iter 12): 340×76 — antes 360 (iter 11). Reducimos el ancho
// porque el botón Play/Stop pasó a ser icon-only (sin texto "GRABAR"/"DETENER")
// y libera ~20-30 px horizontales. La altura 76 permite que los window controls
// no se encimen con el flujo principal.
const COACH_COMPACT_W: f64 = 340.0;
const COACH_COMPACT_H: f64 = 76.0;
// Modo drawer (iter 12): barra superior + panel desplegado abajo.
// 340×420 = 76 (barra) + 344 (drawer panel). Antes era 336 total (260 panel)
// pero el tip card quedaba con ~100 px → tips críticos se cortaban en 2 líneas.
// Ahora el tip card recibe ~184 px = 4-5 líneas legibles.
const COACH_DRAWER_H: f64 = 420.0;
// Legacy expanded 320×540 (mantengo por si futuro botón "Vista completa" lo
// reactiva). El frontend ya no lo usa: el toggle es ahora barra↔drawer.
const COACH_EXPANDED_W: f64 = 320.0;
const COACH_EXPANDED_H: f64 = 540.0;
const COACH_VIS_EVENT: &str = "coach-float-visibility-changed";
const COACH_REQUEST_START_EVENT: &str = "widget-request-start-recording";
const COACH_PREFS_FILE: &str = "widget-preferences.json";
const COACH_PREF_KEY_VISIBLE: &str = "coach_float_visible";

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CoachStatus {
    pub available: bool,
    pub endpoint: String,
    pub tips_model: String,
    pub eval_model: String,
    pub chat_model: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoachModels {
    pub tips_model: String,
    pub eval_model: String,
    pub chat_model: String,
}

// ─── Comandos Tauri ───────────────────────────────────────────────────────────

/// Genera una sugerencia puntual (para chat o test manual).
#[tauri::command]
pub async fn coach_suggest<R: Runtime>(
    app: AppHandle<R>,
    transcript: String,
    meeting_type: Option<String>,
) -> Result<CoachTipUpdate, String> {
    use crate::coach::prompt::{build_user_prompt, MeetingType};

    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let model_id = get_tips_model_id(pool).await;
    let mt = meeting_type
        .as_deref()
        .map(MeetingType::from_str_loose)
        .unwrap_or(MeetingType::Auto);

    let user_prompt = build_user_prompt(&transcript, mt, 0, &[], None);

    let builtin_model = llama_engine::map_to_builtin_id(&model_id).to_string();

    // Usar CoachLlmService::generate_tip_with_template aplica n_ctx=4096 +
    // max_tokens=200 + temp=0.3 (COACH_TIP_CONFIG). Reusa sidecar via pool.
    let coach_service = build_coach_service_with_model(&app, builtin_model).await?;
    let raw = coach_service
        .generate_tip_with_template(
            crate::coach::prompt::COACH_SYSTEM_PROMPT,
            &user_prompt,
            None,
        )
        .await
        .map_err(|e| format!("Coach LLM error: {}", e))?;

    parse_tip_response(&raw).ok_or_else(|| "No se pudo parsear respuesta del coach".to_string())
}

/// Configura el modelo para un propósito específico (tips | eval | chat).
#[tauri::command]
pub async fn coach_set_model_for_purpose<R: Runtime>(
    app: AppHandle<R>,
    purpose: String,
    model: String,
) -> Result<(), String> {
    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let col = match purpose.as_str() {
        "tips" => "tips_model_id",
        "eval" => "eval_model_id",
        "chat" => "chat_model",
        _ => return Err(format!("Propósito desconocido: {}", purpose)),
    };

    let query = format!(
        "INSERT INTO coach_settings (id, {col}) VALUES ('1', ?)
         ON CONFLICT(id) DO UPDATE SET {col} = excluded.{col}"
    );
    sqlx::query(&query)
        .bind(&model)
        .execute(pool)
        .await
        .map_err(|e| format!("Error guardando modelo: {}", e))?;

    info!("✅ Coach model for '{}' set to '{}'", purpose, model);
    Ok(())
}

/// Devuelve los modelos configurados actualmente.
#[tauri::command]
pub async fn coach_get_models<R: Runtime>(app: AppHandle<R>) -> CoachModels {
    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let tips_model = get_tips_model_id(pool).await;
    let eval_model = get_eval_model_id(pool).await;

    let chat_model = sqlx::query_scalar::<_, String>(
        "SELECT chat_model FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| DEFAULT_CHAT_MODEL.to_string());

    CoachModels {
        tips_model,
        eval_model,
        chat_model,
    }
}

/// Devuelve el estado del Coach IA (modelo de tips descargado o no).
#[tauri::command]
pub async fn coach_get_status<R: Runtime>(app: AppHandle<R>) -> CoachStatus {
    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let tips_model_id = get_tips_model_id(pool).await;
    let eval_model_id = get_eval_model_id(pool).await;

    let chat_model = sqlx::query_scalar::<_, String>(
        "SELECT chat_model FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| DEFAULT_CHAT_MODEL.to_string());

    let installed = llama_engine::is_model_installed(&app, &tips_model_id);
    let (available, error) = if installed {
        (true, None)
    } else {
        (
            false,
            Some(format!(
                "El modelo '{}' aún no está descargado. Configura el Coach IA en Ajustes → Pipeline.",
                tips_model_id
            )),
        )
    };

    CoachStatus {
        available,
        endpoint: "builtin-ai-sidecar".to_string(),
        tips_model: tips_model_id,
        eval_model: eval_model_id,
        chat_model,
        error,
    }
}

/// Lanza evaluación post-reunión en background y emite "coach-eval-complete".
#[tauri::command]
pub async fn coach_evaluate_meeting<R: Runtime + 'static>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<(), String> {
    let app2 = app.clone();
    tokio::spawn(async move {
        match evaluate_meeting(&app2, &meeting_id).await {
            Ok(result) => {
                let _ = app2.emit("coach-eval-complete", &result);
                info!("✅ Coach eval emitido para {}", meeting_id);
            }
            Err(e) => {
                warn!("Coach eval falló para {}: {}", meeting_id, e);
                let _ = app2.emit(
                    "coach-eval-error",
                    serde_json::json!({ "meeting_id": meeting_id, "error": e }),
                );
            }
        }
    });
    Ok(())
}

/// Abre la ventana flotante always-on-top del coach.
///
/// `start_compact`: si `Some(true)` la ventana abre en modo compact (idle —
/// 320×130, esquina inferior derecha, solo botón Iniciar grabación). Si es
/// `None` o `Some(false)` abre en modo expanded (320×540, esquina superior
/// derecha) — el comportamiento original que usa el botón "Coach" manual y
/// el menú tray.
///
/// Al abrirse emite `coach-float-visibility-changed { visible: true }` para
/// que el FAB de la main window se oculte y `useCoachFloatOpen` se sincronice.
#[tauri::command]
pub async fn open_floating_coach<R: Runtime>(
    app: AppHandle<R>,
    start_compact: Option<bool>,
) -> Result<(), String> {
    let compact = start_compact.unwrap_or(false);

    if let Some(w) = app.get_webview_window(COACH_FLOAT_LABEL) {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        emit_coach_visibility(&app, true);
        return Ok(());
    }

    // Tamaño inicial depende del modo. El page.tsx tiene su propio toggle
    // entre compact/expanded — el Rust solo decide cómo arranca la ventana.
    let (init_w, init_h) = if compact {
        (COACH_COMPACT_W, COACH_COMPACT_H)
    } else {
        (COACH_EXPANDED_W, COACH_EXPANDED_H)
    };

    // §3.1 Ventana translucida (transparent + skip_taskbar=false). El root
    // del flotante usa background rgba(15,16,24,0.92) + backdrop-filter blur
    // para el efecto glass — ver §3.2 en page.tsx. Riesgo conocido §3.4:
    // Win10 con DWM desactivado puede tener artefactos; aceptado en V1.
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        COACH_FLOAT_LABEL,
        tauri::WebviewUrl::App("coach-float".into()),
    )
    .title("Maity Coach")
    .inner_size(init_w, init_h)
    // min_inner_size importante: si lo dejamos en (280, 110), Tauri respeta
    // el mayor entre min_inner_size e inner_size — con COACH_COMPACT_H=64
    // pediríamos 64 pero Tauri lo subiría a 110 (bug visible en iter 5).
    // Bajamos a 56 para que el compact pueda renderizar a 64 lógicos.
    .min_inner_size(280.0, 56.0)
    .always_on_top(true)
    .decorations(false)
    .resizable(true)
    .skip_taskbar(false)
    .transparent(true)
    // Iter 11: shadow del SO desactivado. DWM (Windows) dibuja drop-shadow
    // rectangular aun cuando el contenido es rounded — eso causaba las
    // "esquinas cuadradas visibles" detrás del coach-float. Sin shadow nativo
    // las esquinas redondeadas del CSS son las únicas visibles. El boxShadow
    // CSS interior compensa la pérdida visual de peso. En macOS shadow es
    // sutil pero también puede dejar artefactos; lo deshabilitamos uniforme.
    .shadow(false)
    // Iter 10: empezar OCULTA para evitar flash blanco del WebView2 antes
    // de que el HTML pinte. Se muestra con .show() después de posicionar
    // + delay corto para esperar el primer paint.
    .visible(false)
    .build()
    .map_err(|e| format!("Error abriendo ventana flotante: {}", e))?;

    // Auto-posicionar. Compact = esquina inferior derecha (estilo widget de
    // grabación, fuera del camino del contenido principal). Expanded = esquina
    // superior derecha (decisión §3.5 original — donde el usuario espera un
    // asistente persistente al grabar).
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let mon_w = size.width as f64 / scale;
        let mon_h = size.height as f64 / scale;
        let (target_x, target_y) = if compact {
            let x = (mon_w - init_w - 80.0).max(0.0);
            let y = (mon_h - init_h - 110.0).max(0.0);
            (x, y)
        } else {
            let x = (mon_w - init_w - 32.0).max(0.0);
            let y = 80.0_f64.min((mon_h - init_h - 32.0).max(0.0));
            (x, y)
        };
        if let Err(e) = window.set_position(LogicalPosition::new(target_x, target_y)) {
            warn!("No se pudo posicionar la ventana flotante: {}", e);
        }
    }

    // Iter 10: esperar a que el WebView2 cargue el HTML antes de mostrar.
    // 180 ms es suficiente para el primer paint con el glass; menos genera
    // flash blanco visible.
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    let _ = window.show();

    emit_coach_visibility(&app, true);
    info!("✅ Floating coach window opened (compact={})", compact);
    Ok(())
}

/// Cierra la ventana flotante del coach.
#[tauri::command]
pub async fn close_floating_coach<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(COACH_FLOAT_LABEL) {
        w.close().map_err(|e| e.to_string())?;
        emit_coach_visibility(&app, false);
    }
    Ok(())
}

/// Devuelve si la ventana del coach-float está actualmente abierta. Usado por
/// el FAB en la main window para decidir su visibilidad inicial.
#[tauri::command]
pub async fn is_coach_float_open<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window(COACH_FLOAT_LABEL).is_some()
}

/// Lee la preferencia de visibilidad del coach-float. Default: true.
#[tauri::command]
pub async fn coach_float_get_visibility_pref<R: Runtime>(app: AppHandle<R>) -> bool {
    load_coach_visibility_pref(&app).unwrap_or(true)
}

/// Persiste la preferencia y abre/cierra la ventana según corresponda.
/// Si `start_compact` es Some(true), abre en modo compact (idle).
#[tauri::command]
pub async fn coach_float_set_visibility_pref<R: Runtime>(
    app: AppHandle<R>,
    visible: bool,
    start_compact: Option<bool>,
) -> Result<(), String> {
    save_coach_visibility_pref(&app, visible)?;
    if visible {
        open_floating_coach(app, start_compact).await?;
    } else {
        close_floating_coach(app).await?;
    }
    Ok(())
}

/// Solicita al frontend principal que inicie la grabación reusando el flujo canónico de
/// `useRecordingStart`. Emite directamente el evento sin tocar la visibilidad de la main
/// window — el `RecordingWidgetListener` sigue activo aunque la ventana esté minimizada
/// gracias a las flags Chromium `--disable-renderer-backgrounding` configuradas en
/// `tauri.conf.json` (coherente con `recording_widget_request_start`, US-3).
#[tauri::command]
pub async fn coach_float_request_start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.emit(COACH_REQUEST_START_EVENT, ())
        .map_err(|e| format!("Failed to emit widget-request-start-recording: {}", e))?;
    info!("📡 Coach-float solicitó iniciar grabación al main (sin alterar visibilidad)");
    Ok(())
}

/// Variante de `coach_float_request_start` que propaga la selección de
/// dispositivos hecha en el coach-float (iter 6). El listener global recibe
/// el payload `{ micDevice, sysDevice }`, llama `setSelectedDevices()` en el
/// ConfigContext y luego dispara `handleRecordingStart()` con los devices ya
/// actualizados.
///
/// Si `mic_device` o `sys_device` son `None`, se mantiene el default actual
/// del ConfigContext (no se sobreescribe).
#[tauri::command]
pub async fn coach_float_request_start_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device: Option<String>,
    sys_device: Option<String>,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "micDevice": mic_device,
        "sysDevice": sys_device,
    });
    app.emit(COACH_REQUEST_START_EVENT, payload)
        .map_err(|e| format!("Failed to emit widget-request-start-recording with devices: {}", e))?;
    info!("📡 Coach-float solicitó iniciar grabación con devices custom (sin alterar visibilidad)");
    Ok(())
}

/// Detiene la grabación generando el save_path internamente (mismo patrón
/// que `tray.rs:206-244` y el `stop_recording_from_widget` viejo). Permite al
/// coach-float detener sin que el frontend tenga que conocer `app_data_dir`.
///
/// SNAPSHOT del estado minimizado de la main window (US-4, coherente con
/// `stop_recording_from_widget`): si el usuario estaba con main minimizada al apretar
/// Stop en el coach-float, seteamos `KEEP_MAIN_MINIMIZED_AFTER_STOP=true` para que el
/// handler de `on_window_event` re-minimice tras el hard navigate del `useRecordingStop`.
#[tauri::command]
pub async fn coach_float_stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let was_minimized = main.is_minimized().unwrap_or(false);
        crate::KEEP_MAIN_MINIMIZED_AFTER_STOP.store(was_minimized, Ordering::Relaxed);
        if was_minimized {
            info!("Coach stop: main estaba minimizada, flag set para re-minimize post-navigate");
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
            info!("✅ Recording stopped from coach-float");
            if let Err(e) = app.emit("recording-stop-complete", true) {
                warn!("Coach-float: failed to emit recording-stop-complete: {}", e);
            }
            Ok(())
        }
        Err(e) => Err(format!("Failed to stop recording from coach-float: {}", e)),
    }
}

// ─── Helpers de persistencia / visibility ────────────────────────────────────

fn load_coach_visibility_pref<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let store = app.store(COACH_PREFS_FILE).ok()?;
    let value = store.get(COACH_PREF_KEY_VISIBLE)?;
    value.as_bool()
}

/// Persiste la preferencia de visibilidad del coach-float al store. `pub(crate)` para que
/// el `setup()` en lib.rs pueda forzar la pref a `true` al arrancar por autostart — la
/// flotante es el único entry point cuando la main window está minimizada, así que el
/// boot-by-OS sobrescribe cualquier "X→hide" previo en sesión anterior.
pub(crate) fn save_coach_visibility_pref<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    let store = app
        .store(COACH_PREFS_FILE)
        .map_err(|e| format!("Failed to access widget preferences store: {}", e))?;
    store.set(COACH_PREF_KEY_VISIBLE, serde_json::Value::Bool(visible));
    store
        .save()
        .map_err(|e| format!("Failed to persist widget preferences: {}", e))?;
    Ok(())
}

fn emit_coach_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Err(e) = app.emit(COACH_VIS_EVENT, serde_json::json!({ "visible": visible })) {
        warn!("Failed to emit {}: {}", COACH_VIS_EVENT, e);
    }
}

// ─── Device Picker (mini-ventana flotante para seleccionar mic/sis) ──────────
// Iter 9: el dropdown de devices en el coach-float quedaba cortado por
// `overflow:hidden` del webview (ventana de 64 px de alto). Solución: una
// mini-ventana Tauri secundaria que aparezca encima del icono mic/sis con la
// lista, y se cierre al perder foco (click fuera).

const DEVICE_PICKER_LABEL: &str = "device-picker";
const DEVICE_PICKER_HEIGHT: f64 = 220.0; // alto fijo; scrollable adentro

/// Abre la mini-ventana de selección de dispositivos posicionada encima del
/// icono que la invoca. El frontend pasa las coordenadas globales del icono
/// (calculadas con getBoundingClientRect + outerPosition).
#[tauri::command]
pub async fn open_device_picker<R: Runtime>(
    app: AppHandle<R>,
    device_type: String, // "mic" | "sys"
    anchor_x: f64,       // posición global X del icono (top-left)
    anchor_y: f64,       // posición global Y del icono (top-left)
    width: f64,          // ancho deseado para el picker
) -> Result<(), String> {
    // Si ya existe, cerrar primero — fuerza refresh de devices al reabrir.
    if let Some(existing) = app.get_webview_window(DEVICE_PICKER_LABEL) {
        let _ = existing.close();
    }

    let url = format!("device-picker?type={}", device_type);
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        DEVICE_PICKER_LABEL,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Device Picker")
    .inner_size(width, DEVICE_PICKER_HEIGHT)
    .min_inner_size(width, DEVICE_PICKER_HEIGHT)
    .always_on_top(true)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .transparent(true)
    // Iter 10: empezar OCULTA (visible(false)) y mostrar después del primer
    // paint. Antes el flash blanco era muy visible porque el device-picker
    // se abre on-demand al click del icono. focused(true) movido a después
    // del show porque el builder lo ignora si visible(false).
    .visible(false)
    .build()
    .map_err(|e| format!("Error abriendo device-picker: {}", e))?;

    // Posicionar arriba del icono (anchor_y - alto del picker - 8 px margen).
    let target_y = (anchor_y - DEVICE_PICKER_HEIGHT - 8.0).max(0.0);
    if let Err(e) = window.set_position(LogicalPosition::new(anchor_x, target_y)) {
        warn!("No se pudo posicionar device-picker: {}", e);
    }

    // on_window_event: cerrar al perder foco. Click fuera = blur = close.
    // En Windows con DPI 125% esto a veces dispara dos veces — el segundo
    // close es no-op porque la ventana ya no existe (get_webview_window None).
    let app_handle_for_blur = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            if let Some(w) = app_handle_for_blur.get_webview_window(DEVICE_PICKER_LABEL) {
                let _ = w.close();
            }
        }
    });

    // Iter 10: esperar a que el WebView2 cargue el HTML antes de mostrar.
    // 100ms basta porque la página es muy pequeña. Después set_focus para que
    // el blur listener funcione (cerrar al click fuera).
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let _ = window.show();
    let _ = window.set_focus();

    info!("✅ Device picker abierto para '{}'", device_type);
    Ok(())
}

/// Cierra la mini-ventana de device-picker. Idempotente.
#[tauri::command]
pub async fn close_device_picker<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(DEVICE_PICKER_LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// El device-picker invoca esto al click en un device. Emite el evento
/// global `device-picker-selected` (que escucha el coach-float) y cierra
/// la propia ventana.
#[tauri::command]
pub async fn device_picker_select<R: Runtime>(
    app: AppHandle<R>,
    device_name: String,
    device_type: String, // "Microphone" | "SystemAudio"
) -> Result<(), String> {
    app.emit(
        "device-picker-selected",
        serde_json::json!({ "deviceName": device_name, "deviceType": device_type }),
    )
    .map_err(|e| format!("Failed to emit device-picker-selected: {}", e))?;

    // Cerrar la propia ventana después de emitir.
    if let Some(w) = app.get_webview_window(DEVICE_PICKER_LABEL) {
        let _ = w.close();
    }
    info!("📡 Device picker: seleccionado '{}' ({})", device_name, device_type);
    Ok(())
}

/// Helper interno que el `setup` de lib.rs llama al inicio para decidir si
/// abrir el coach-float automáticamente según la preferencia guardada.
pub fn should_auto_open_coach<R: Runtime>(app: &AppHandle<R>) -> bool {
    load_coach_visibility_pref(app).unwrap_or(true)
}

/// Setea explícitamente el tamaño de la ventana coach-float (iter 11):
/// - `drawer: false` → barra sola (360×76).
/// - `drawer: true` → barra + drawer panel (360×336).
///
/// El frontend lo invoca cuando empieza grabación (auto-abrir drawer) y al
/// detener (cerrar drawer). También se usa al toggle manual del Chevron.
/// Es idempotente — no depende del tamaño actual.
///
/// Cambio breaking respecto a iter 10: el parámetro era `expanded: bool` y
/// abría a 320×540 (dashboard completo distinto). Ahora el dashboard separado
/// quedó out-of-scope V12. Si algún caller antiguo manda `expanded: true`,
/// recibirá `drawer: true` por el rename del campo serde.
#[tauri::command]
pub async fn coach_float_set_size<R: Runtime>(
    app: AppHandle<R>,
    drawer: bool,
) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(COACH_FLOAT_LABEL) {
        let (width, height) = if drawer {
            (COACH_COMPACT_W, COACH_DRAWER_H)
        } else {
            (COACH_COMPACT_W, COACH_COMPACT_H)
        };
        w.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Alterna entre modo compacto y expandido en la ventana flotante.
/// Compact 140x110 (cuadradito tipo widget) — match con el repo de referencia.
/// Antes 320x80 (barra horizontal estirada) hacia que el contenido del compact
/// no se viera coherente con el resto de la UI.
#[tauri::command]
pub async fn floating_toggle_compact<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("coach-float") {
        let size = w.inner_size().map_err(|e| e.to_string())?;
        let scale = w.scale_factor().unwrap_or(1.0);
        let logical_height = size.height as f64 / scale;
        // Threshold 200 logical px: arriba de eso = expandido -> ir a compact;
        // abajo = compact -> ir a expandido.
        let (new_w, new_h): (f64, f64) = if logical_height > 200.0 {
            (140.0, 110.0)
        } else {
            (320.0, 480.0)
        };
        w.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: new_w,
            height: new_h,
        }))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Comandos GGUF ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GgufModelInfo {
    pub id: String,
    pub name: String,
    pub size_gb: f32,
    pub ram_gb: f32,
    pub use_case: String,
    pub description: String,
    pub installed: bool,
    pub is_tips_model: bool,
    pub is_eval_model: bool,
}

/// Lista todos los modelos GGUF del registry con estado de instalación.
#[tauri::command]
pub async fn coach_list_gguf_models<R: Runtime>(app: AppHandle<R>) -> Vec<GgufModelInfo> {
    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let tips_id = get_tips_model_id(pool).await;
    let eval_id = get_eval_model_id(pool).await;

    model_registry::MODELS
        .iter()
        .map(|def| GgufModelInfo {
            id: def.id.to_string(),
            name: def.name.to_string(),
            size_gb: def.size_gb,
            ram_gb: def.ram_gb,
            use_case: def.use_case.to_string(),
            description: def.description.to_string(),
            installed: llama_engine::is_model_installed(&app, def.id),
            is_tips_model: tips_id == def.id,
            is_eval_model: eval_id == def.id,
        })
        .collect()
}

/// Descarga un modelo GGUF en background, emitiendo "coach-gguf-download-progress".
#[tauri::command]
pub async fn coach_download_gguf_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let app2 = app.clone();
    tokio::spawn(async move {
        match crate::coach::setup::download_gguf_model_file(&app2, &model_id).await {
            Ok(()) => {
                let _ = app2.emit(
                    "coach-gguf-download-complete",
                    serde_json::json!({ "model_id": model_id }),
                );
            }
            Err(e) => {
                warn!("Error descargando modelo {}: {}", model_id, e);
                let _ = app2.emit(
                    "coach-gguf-download-error",
                    serde_json::json!({ "model_id": model_id, "error": e }),
                );
            }
        }
    });
    Ok(())
}

/// Cambia el modelo activo para un propósito (tips | eval) y persiste en DB.
/// El sidecar carga modelos a demanda en la próxima generación, no hay servidor que reiniciar.
#[tauri::command]
pub async fn coach_switch_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    purpose: String,
    model_id: String,
) -> Result<(), String> {
    model_registry::get_model(&model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;

    if !llama_engine::is_model_installed(&app, &model_id) {
        return Err(format!(
            "Modelo '{}' no descargado. Descárgalo primero.",
            model_id
        ));
    }

    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let col = match purpose.as_str() {
        "tips" => "tips_model_id",
        "eval" => "eval_model_id",
        _ => return Err(format!("Propósito desconocido: {}", purpose)),
    };

    let query = format!(
        "INSERT INTO coach_settings (id, {col}) VALUES ('1', ?)
         ON CONFLICT(id) DO UPDATE SET {col} = excluded.{col}"
    );
    sqlx::query(&query)
        .bind(&model_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Error guardando modelo: {}", e))?;

    let _ = app.emit(
        "coach-engine-ready",
        serde_json::json!({ "purpose": purpose, "model_id": model_id }),
    );

    info!("✅ Modelo de {} cambiado a {}", purpose, model_id);
    Ok(())
}

/// Elimina el archivo GGUF descargado de un modelo.
#[tauri::command]
pub async fn coach_delete_gguf_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    model_registry::get_model(&model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;

    let path = llama_engine::model_file_path(&app, &model_id)
        .ok_or_else(|| format!("No se pudo resolver la ruta del modelo '{}'", model_id))?;

    if !path.exists() {
        return Err(format!("El modelo '{}' no está descargado", model_id));
    }

    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| format!("Error eliminando modelo '{}': {}", model_id, e))?;

    info!("🗑️  Modelo GGUF eliminado: {}", model_id);
    Ok(())
}

/// Devuelve el historial de tips de la sesión activa (máx 20, FIFO).
/// Devuelve lista vacía si no hay sesión activa — nunca falla.
#[tauri::command]
pub fn coach_get_session_tips() -> Vec<CoachTipUpdate> {
    crate::coach::live_feedback::get_session_tips()
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

async fn get_tips_model_id(pool: &sqlx::SqlitePool) -> String {
    let stored = sqlx::query_scalar::<_, String>(
        "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "gemma3-4b-q4".to_string());
    if model_registry::get_model(&stored).is_some() {
        stored
    } else {
        "gemma3-4b-q4".to_string()
    }
}

async fn get_eval_model_id(pool: &sqlx::SqlitePool) -> String {
    let stored = sqlx::query_scalar::<_, String>(
        "SELECT eval_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "qwen25-7b-q4".to_string());
    if model_registry::get_model(&stored).is_some() {
        stored
    } else {
        "qwen25-7b-q4".to_string()
    }
}

fn parse_tip_response(raw: &str) -> Option<CoachTipUpdate> {
    let text = raw.trim();
    let start = if text.starts_with('{') {
        0
    } else {
        text.find('{')?
    };
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    let json_str = &text[start..=end];

    #[derive(Deserialize)]
    struct Raw {
        tip: Option<String>,
        tip_type: Option<String>,
        category: Option<String>,
        priority: Option<String>,
        confidence: Option<f64>,
    }

    let parsed: Raw = serde_json::from_str(json_str).ok()?;
    let tip = parsed.tip?.trim().to_string();
    if tip.is_empty() {
        return None;
    }

    Some(CoachTipUpdate {
        tip,
        tip_type: parsed.tip_type.unwrap_or_else(|| "observation".to_string()),
        category: parsed.category.unwrap_or_else(|| "pacing".to_string()),
        priority: parsed.priority.unwrap_or_else(|| "soft".to_string()),
        confidence: parsed.confidence.unwrap_or(0.5),
        trigger: None,
        timestamp_secs: 0,
    })
}

// ─── Chat IA con acceso autónomo a conversaciones ────────────────────────────

/// Un turno del historial de chat enviado desde el frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

/// Payload del comando coach_chat.
#[derive(Debug, Deserialize)]
pub struct ChatQuery {
    /// Historial de la conversación (sin el turno system, se inyecta server-side).
    pub messages: Vec<ChatTurn>,
}

/// Respuesta enviada al frontend.
#[derive(Debug, Serialize)]
pub struct ChatReply {
    pub content: String,
    pub model: String,
    pub provider: String,
}

/// Construye el system prompt del agente inyectando datos reales de todas
/// las conversaciones del usuario más fragmentos relevantes a la pregunta.
async fn build_agent_system_prompt(pool: &sqlx::SqlitePool, user_question: &str) -> String {
    let base = "Eres Maity, asistente personal de comunicación. \
        Tienes acceso completo a las conversaciones y análisis del usuario. \
        Responde siempre en español. \
        Sé conciso y orientado a acción (máximo 3 párrafos). \
        Cita reuniones específicas por nombre cuando sea relevante.";

    #[derive(sqlx::FromRow)]
    struct MeetingRow {
        id: String,
        title: String,
        created_at: String,
    }

    let meetings = sqlx::query_as::<_, MeetingRow>(
        "SELECT id, title, created_at FROM meetings ORDER BY created_at DESC LIMIT 30",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if meetings.is_empty() {
        return format!(
            "{}\n\nEl usuario aún no tiene conversaciones registradas.",
            base
        );
    }

    #[derive(sqlx::FromRow)]
    struct SummaryRow {
        meeting_id: String,
        result: String,
    }

    let summaries = sqlx::query_as::<_, SummaryRow>(
        "SELECT meeting_id, result FROM summary_processes \
         WHERE status = 'completed' AND result IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    use std::collections::HashMap;
    let score_map: HashMap<String, f64> = summaries
        .into_iter()
        .filter_map(|row| {
            let v: serde_json::Value = serde_json::from_str(&row.result).ok()?;
            let score = v["resumen"]["puntuacion_global"]
                .as_f64()
                .or_else(|| v["calidad_global"]["puntaje"].as_f64())?;
            Some((row.meeting_id, score))
        })
        .collect();

    let scores: Vec<f64> = score_map.values().copied().collect();
    let avg_score = if scores.is_empty() {
        None
    } else {
        Some(scores.iter().sum::<f64>() / scores.len() as f64)
    };

    let first_date = meetings.last().map(|m| m.created_at[..10].to_string()).unwrap_or_default();
    let last_date = meetings.first().map(|m| m.created_at[..10].to_string()).unwrap_or_default();

    let mut profile = format!(
        "PERFIL DEL USUARIO:\n\
         - Total de conversaciones: {}\n\
         - Período: {} → {}\n",
        meetings.len(),
        first_date,
        last_date,
    );
    if let Some(avg) = avg_score {
        profile.push_str(&format!("- Promedio de puntuación: {:.0}/100\n", avg));
    }

    profile.push_str("\nCONVERSACIONES (más recientes primero):\n");
    for (i, m) in meetings.iter().take(15).enumerate() {
        let date = &m.created_at[..10.min(m.created_at.len())];
        if let Some(score) = score_map.get(&m.id) {
            profile.push_str(&format!(
                "{}. \"{}\" — {} — Puntuación: {:.0}/100\n",
                i + 1,
                m.title,
                date,
                score
            ));
        } else {
            profile.push_str(&format!("{}. \"{}\" — {}\n", i + 1, m.title, date));
        }
    }

    let keywords: Vec<&str> = user_question
        .split_whitespace()
        .filter(|w| w.len() > 4)
        .take(4)
        .collect();

    let mut relevant_block = String::new();
    let mut seen_meetings: std::collections::HashSet<String> = std::collections::HashSet::new();

    for keyword in &keywords {
        if seen_meetings.len() >= 3 {
            break;
        }
        #[derive(sqlx::FromRow)]
        struct SearchRow {
            title: String,
            transcript: String,
            meeting_id: String,
        }
        let pattern = format!("%{}%", keyword.to_lowercase());
        let rows = sqlx::query_as::<_, SearchRow>(
            "SELECT m.title, t.transcript, t.meeting_id \
             FROM meetings m JOIN transcripts t ON m.id = t.meeting_id \
             WHERE LOWER(t.transcript) LIKE ? LIMIT 3",
        )
        .bind(&pattern)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for row in rows {
            if seen_meetings.contains(&row.meeting_id) {
                continue;
            }
            seen_meetings.insert(row.meeting_id);
            let snippet: String = row.transcript.chars().take(200).collect();
            relevant_block.push_str(&format!(
                "→ De \"{}\": \"...{}...\"\n",
                row.title, snippet
            ));
            if seen_meetings.len() >= 3 {
                break;
            }
        }
    }

    let mut prompt = format!("{}\n\n{}", base, profile);
    if !relevant_block.is_empty() {
        prompt.push_str(&format!("\nFRAGMENTOS RELEVANTES:\n{}", relevant_block));
    }
    prompt
}

/// Aplana el historial de chat a system + user prompt para el sidecar BuiltInAI.
async fn call_coach_builtin<R: tauri::Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    system_prompt: &str,
    turns: &[ChatTurn],
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener app_data_dir: {}", e))?;

    let user_prompt = if turns.len() <= 1 {
        turns
            .last()
            .map(|t| t.content.clone())
            .unwrap_or_default()
    } else {
        let mut buf = String::from("Historial previo:\n");
        for turn in &turns[..turns.len() - 1] {
            let role = if turn.role == "user" { "Usuario" } else { "Asistente" };
            buf.push_str(&format!("{}: {}\n", role, turn.content));
        }
        buf.push_str("---\nMensaje actual: ");
        buf.push_str(&turns.last().map(|t| t.content.as_str()).unwrap_or(""));
        buf
    };

    let builtin_model = llama_engine::map_to_builtin_id(model_id);

    generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::BuiltInAI,
        builtin_model,
        "",
        system_prompt,
        &user_prompt,
        None,
        None,
        Some(512),
        Some(0.7),
        None,
        Some(&app_data_dir),
        None,
    )
    .await
}

/// Comando principal: usa el sidecar Built-in AI con el modelo de tips configurado.
#[tauri::command]
pub async fn coach_chat<R: tauri::Runtime>(
    app: AppHandle<R>,
    query: ChatQuery,
) -> Result<ChatReply, String> {
    let state = app.state::<AppState>(); // state-allow: pre-existing, refactor in separate PR
    let pool = state.db_manager.pool();

    let user_question = query
        .messages
        .last()
        .map(|m| m.content.as_str())
        .unwrap_or("");

    let system_prompt = build_agent_system_prompt(pool, user_question).await;

    let turns: &[ChatTurn] = if query.messages.len() > 10 {
        &query.messages[query.messages.len() - 10..]
    } else {
        &query.messages
    };

    let model_id = get_tips_model_id(pool).await;
    if !llama_engine::is_model_installed(&app, &model_id) {
        return Err(format!(
            "El modelo '{}' aún no está descargado. Configura el Coach IA en Ajustes → Pipeline.",
            model_id
        ));
    }

    match call_coach_builtin(&app, &model_id, &system_prompt, turns).await {
        Ok(content) => Ok(ChatReply {
            content,
            model: model_id,
            provider: "builtin-ai".to_string(),
        }),
        Err(e) => {
            warn!("Coach Built-in AI falló: {}", e);
            Err(format!("Coach IA no disponible: {}", e))
        }
    }
}
