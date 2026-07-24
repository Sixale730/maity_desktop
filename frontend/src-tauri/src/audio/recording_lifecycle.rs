// audio/recording_lifecycle.rs
//
// Recording lifecycle management: start, stop, pause, resume.
// Contains the global state and core lifecycle transitions.

use log::{error, info, warn};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::task::JoinHandle;

use super::RecordingManager;

use super::recording_helpers;
use crate::events;

// ============================================================================
// GLOBAL STATE
// ============================================================================

/// Global recording manager and transcription task to keep them alive during recording
pub(crate) static RECORDING_MANAGER: Mutex<Option<RecordingManager>> = Mutex::new(None);
pub(crate) static TRANSCRIPTION_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Listener ID for proper cleanup - prevents microphone from staying active after recording stops
pub(crate) static TRANSCRIPT_LISTENER_ID: Mutex<Option<tauri::EventId>> = Mutex::new(None);

/// Guard so only ONE "still paused" reminder task runs at a time.
static PAUSE_REMINDER_RUNNING: AtomicBool = AtomicBool::new(false);
/// Escalado de recordatorios de pausa: a los 2, 5, 10 y 15 min de pausa, luego cada
/// 15 min (deltas de espera entre recordatorios). El intervalo fijo anterior (2 min)
/// generaba ~30 toasts/hora — fatiga de alertas — y aun así el usuario no los veía
/// porque Windows suprime toasts al compartir pantalla (Focus Assist automático).
const PAUSE_REMINDER_SCHEDULE_SECS: [u64; 4] = [120, 180, 300, 300];
const PAUSE_REMINDER_STEADY_SECS: u64 = 900;

// Single-flight y estado de fase: viven en `recording_phase` (máquina de fases
// única con gates RAII, fuente de verdad global). `StartGate::acquire()` subsume
// en UNA sola CAS el viejo single-flight + el check de "¿ya grabando?" (TOCTOU de
// los 5 arranques en 16 ms, jul-2026).
use super::recording_phase::{self, RecordingPhase, StartGate, StopGate};

/// Check if recording is active (derivado de la máquina de fases; false en
/// Starting y Stopping).
pub fn is_recording_active() -> bool {
    recording_phase::current_phase().is_session_active()
}

// ============================================================================
// START RECORDING
// ============================================================================

/// Start recording with default devices (loads preferences for device resolution)
pub async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start_recording_with_meeting_name(app, None).await
}

/// Start recording with default devices and optional meeting name
pub async fn start_recording_with_meeting_name<R: Runtime>(
    app: AppHandle<R>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with default devices, meeting: {:?}",
        meeting_name
    );

    // Idle→Starting en una sola CAS: gate + "¿ya grabando?" son la misma operación.
    // El gate viaja hasta initialize_recording, que lo comitea (Starting→Recording)
    // en el punto exacto donde la sesión queda activa. Drop sin commit → Idle.
    let start_gate = StartGate::acquire()?;
    info!("🔍 Fase: {:?} (gate de arranque adquirido)", recording_phase::current_phase());

    // Validate transcription model
    recording_helpers::validate_transcription_ready(&app).await?;

    info!("🚀 Starting async recording initialization");

    // Load recording preferences to get auto_save AND device preferences
    let (auto_save, preferred_mic_name, preferred_system_name) =
        match super::recording_preferences::load_recording_preferences(&app).await {
            Ok(prefs) => {
                info!("📋 Loaded recording preferences: auto_save={}, preferred_mic={:?}, preferred_system={:?}",
                      prefs.auto_save, prefs.preferred_mic_device, prefs.preferred_system_device);
                (prefs.auto_save, prefs.preferred_mic_device, prefs.preferred_system_device)
            }
            Err(e) => {
                warn!("Failed to load recording preferences, using defaults: {}", e);
                (true, None, None)
            }
        };

    // Resolve devices from preferences
    let microphone_device =
        recording_helpers::resolve_microphone_from_preference(&app, preferred_mic_name).await?;
    let system_device = recording_helpers::resolve_system_audio_from_preference(preferred_system_name);

    // Initialize recording with resolved devices (comitea el gate al activar la sesión)
    recording_helpers::initialize_recording(&app, microphone_device, system_device, meeting_name, auto_save, start_gate).await?;

    // Emit success event
    app.emit(events::RECORDING_STARTED, serde_json::json!({
        "message": "Recording started successfully with parallel processing",
        "devices": ["Default Microphone", "Default System Audio"],
        "workers": 3
    })).map_err(|e| e.to_string())?;

    // Update tray menu to reflect recording state
    crate::tray::update_tray_menu(&app);

    // Start live feedback engine (non-blocking — ignores errors if Ollama unavailable)
    if let Err(e) = crate::coach::live_feedback::start(app.clone()).await {
        warn!("Coach live feedback not started: {}", e);
    }

    info!("✅ Recording started successfully with async-first approach");

    Ok(())
}

/// Start recording with specific devices
pub async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

/// Start recording with specific devices and optional meeting name
pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with specific devices: mic={:?}, system={:?}, meeting={:?}",
        mic_device_name, system_device_name, meeting_name
    );

    // Idle→Starting en una sola CAS (ver comentario en start_recording_with_meeting_name).
    let start_gate = StartGate::acquire()?;
    info!("🔍 Fase: {:?} (gate de arranque adquirido)", recording_phase::current_phase());

    // Skip transcription validation here — frontend already validated via checkTranscriptionReady()
    info!("🚀 Starting async recording initialization with custom devices");

    // Parse explicit device names
    let devices =
        recording_helpers::parse_explicit_devices(&app, &mic_device_name, &system_device_name)
            .await?;

    // Load recording preferences for auto_save setting
    let auto_save = match super::recording_preferences::load_recording_preferences(&app).await {
        Ok(prefs) => {
            info!("📋 Loaded recording preferences: auto_save={}", prefs.auto_save);
            prefs.auto_save
        }
        Err(e) => {
            warn!("Failed to load recording preferences, defaulting to auto_save=true: {}", e);
            true
        }
    };

    // Initialize recording with explicit devices (comitea el gate al activar la sesión)
    recording_helpers::initialize_recording(&app, devices.microphone, devices.system_audio, meeting_name, auto_save, start_gate).await?;

    // Emit success event
    app.emit(events::RECORDING_STARTED, serde_json::json!({
        "message": "Recording started with custom devices and parallel processing",
        "devices": [
            mic_device_name.unwrap_or_else(|| "Default Microphone".to_string()),
            system_device_name.unwrap_or_else(|| "Default System Audio".to_string())
        ],
        "workers": 3
    })).map_err(|e| e.to_string())?;

    // Update tray menu to reflect recording state
    crate::tray::update_tray_menu(&app);

    // Start live feedback engine (non-blocking — ignores errors if Ollama unavailable)
    if let Err(e) = crate::coach::live_feedback::start(app.clone()).await {
        warn!("Coach live feedback not started: {}", e);
    }

    info!("✅ Recording started with custom devices using async-first approach");

    Ok(())
}

// ============================================================================
// STOP RECORDING
// ============================================================================

/// Stop recording with optimized graceful shutdown ensuring NO transcript chunks are lost
pub async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    args: super::recording_commands::RecordingArgs,
) -> Result<(), String> {
    stop_recording_reporting(app, args).await.map(|_| ())
}

/// Variante que reporta si ESTE caller adquirió el StopGate (`true`) o si otro actor ya
/// estaba deteniendo/detuvo (`false`, stop idempotente). Los callers que encadenan
/// side-effects post-stop (finalize headless del scheduler en rotación/cierre de jornada)
/// DEBEN usar esta variante: con `false`, el actor concurrente ya disparó su propio
/// post-procesado y duplicar el guardado crearía una reunión repetida.
pub async fn stop_recording_reporting<R: Runtime>(
    app: AppHandle<R>,
    _args: super::recording_commands::RecordingArgs,
) -> Result<bool, String> {
    info!(
        "🛑 Starting optimized recording shutdown - ensuring ALL transcript chunks are preserved"
    );

    // Recording|Paused → Stopping en una sola CAS. La fase Stopping modela el
    // "corte temprano" de la sesión: deja de estar activa hacia afuera
    // (eventos/queries) mientras el pipeline drena. Bonus vs el check anterior:
    // dos stops concurrentes ya no pueden pasar ambos — solo uno gana la CAS,
    // el otro retorna Ok idempotente. El Drop del gate garantiza Stopping→Idle
    // en TODOS los caminos de salida (incluidos los `return Err` de en medio):
    // la fase no puede quedar clavada bloqueando arranques futuros.
    let stop_gate = match StopGate::acquire() {
        Ok(gate) => gate,
        Err(observed) => {
            info!("Recording was not active (fase: {:?})", observed);
            return Ok(false);
        }
    };
    info!("🔍 Fase Stopping adquirida — la sesión ya no está activa hacia afuera");

    // Capturar wall-clock duration ANTES de que el manager sea tomado/dropeado.
    // Esto se incluira en el evento recording-stopped para que el frontend tenga
    // la duracion real (Instant::elapsed) y no dependa de timestamps sample-based
    // del VAD que pueden estar inflados 2x por sample rate mismatch.
    let captured_duration_seconds: Option<f64> = RECORDING_MANAGER
        .lock()
        .ok()
        .and_then(|guard| {
            guard.as_ref().and_then(|m| {
                m.get_active_recording_duration()
                    .or_else(|| m.get_recording_duration())
            })
        });
    info!(
        "🕒 Captured wall-clock recording duration: {:?}s (before manager teardown)",
        captured_duration_seconds
    );

    // Emit shutdown progress to frontend
    let _ = app.emit(
        events::RECORDING_SHUTDOWN_PROGRESS,
        serde_json::json!({
            "stage": "stopping_audio",
            "message": "Stopping audio capture...",
            "progress": 20
        }),
    );

    // Step 1: Stop audio capture immediately (no more new chunks) with proper error handling
    let manager_for_cleanup = {
        let mut global_manager = RECORDING_MANAGER.lock().map_err(|e| format!("Recording manager lock poisoned: {}", e))?;
        global_manager.take()
    };

    let stop_result = if let Some(mut manager) = manager_for_cleanup {
        // Use FORCE FLUSH to immediately process all accumulated audio
        info!("🚀 Using FORCE FLUSH to eliminate pipeline accumulation delays");
        let result = manager.stop_streams_and_force_flush().await;
        let manager_for_cleanup = Some(manager);
        (result, manager_for_cleanup)
    } else {
        warn!("No recording manager found to stop");
        (Ok(()), None)
    };

    let (stop_result, manager_for_cleanup) = stop_result;

    match stop_result {
        Ok(_) => {
            info!("✅ Audio streams stopped successfully - no more chunks will be created");
        }
        Err(e) => {
            error!("❌ Failed to stop audio streams: {}", e);
            return Err(format!("Failed to stop audio streams: {}", e));
        }
    }

    // Step 1.5: Clean up transcript listener to release microphone
    {
        use tauri::Listener;
        if let Some(listener_id) = TRANSCRIPT_LISTENER_ID.lock().map_err(|e| format!("Listener ID lock poisoned: {}", e))?.take() {
            app.unlisten(listener_id);
            info!("✅ Transcript-update listener removed");
        }
    }

    // Stop live feedback engine
    crate::coach::live_feedback::stop(&app);

    // Step 2: Signal transcription workers to finish processing ALL queued chunks
    let _ = app.emit(
        events::RECORDING_SHUTDOWN_PROGRESS,
        serde_json::json!({
            "stage": "processing_transcripts",
            "message": "Processing remaining transcript chunks...",
            "progress": 40
        }),
    );

    // Wait for transcription task with enhanced progress monitoring
    let transcription_task = {
        let mut global_task = TRANSCRIPTION_TASK.lock().map_err(|e| format!("Transcription task lock poisoned: {}", e))?;
        global_task.take()
    };

    if let Some(mut task_handle) = transcription_task {
        info!("Waiting for transcription to finish (2 min max)");

        // Adaptive timeout: 2 min max, but stop early if no progress for 15s
        let max_timeout = std::time::Duration::from_secs(120);
        // A los 60s se pide cancelación cooperativa (el worker drena la cola
        // rápido); si a los 120s sigue viva se aborta la task: dropear el
        // JoinHandle NO la termina, y una task huérfana retiene su cola de
        // chunks (decenas de MB de PCM) y compite por CPU con la siguiente
        // grabación.
        let cancel_after = std::time::Duration::from_secs(60);
        let start = std::time::Instant::now();
        let mut task_done = false;
        let mut cancellation_requested = false;

        loop {
            tokio::select! {
                result = &mut task_handle => {
                    match result {
                        Ok(()) => info!("All transcription chunks processed successfully"),
                        Err(e) => warn!("Transcription task completed with error: {:?}", e),
                    }
                    task_done = true;
                    break;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(1500)) => {
                    let elapsed = start.elapsed();

                    // Emit progress event for frontend
                    let _ = app.emit(
                        events::RECORDING_SHUTDOWN_PROGRESS,
                        serde_json::json!({
                            "stage": "processing_transcripts",
                            "message": format!("Processing transcripts... ({:.0}s elapsed)", elapsed.as_secs_f64()),
                            "progress": 40,
                            "detailed": true,
                            "elapsed_seconds": elapsed.as_secs()
                        }),
                    );

                    // Cancelación cooperativa antes del abort duro
                    if !cancellation_requested && elapsed >= cancel_after {
                        warn!("Transcription still running after 60s — requesting cooperative cancellation");
                        super::transcription::worker::request_cancellation();
                        cancellation_requested = true;
                    }

                    // Check max timeout (2 minutes)
                    if elapsed >= max_timeout {
                        warn!("Transcription timeout (2 min) reached, continuing shutdown");
                        break;
                    }

                }
            }
        }

        if !task_done {
            warn!("Transcription task still running after timeout — aborting to free its queue");
            task_handle.abort();
        }
    } else {
        info!("No transcription task found to wait for");
    }

    // Step 3: Keep transcription model loaded in memory for fast recording restart
    // ~600MB RAM footprint is acceptable for a desktop meeting app.
    // Avoids 2-8s model reload delay on next recording start.
    info!("Transcription model kept loaded in memory for next recording");

    // Step 4: Finalize recording state and cleanup resources safely
    let _ = app.emit(
        events::RECORDING_SHUTDOWN_PROGRESS,
        serde_json::json!({
            "stage": "finalizing",
            "message": "Finalizing recording and cleaning up resources...",
            "progress": 90
        }),
    );

    let (meeting_folder, meeting_name) = if let Some(mut manager) = manager_for_cleanup {
        info!("🧹 Performing final cleanup and saving recording data");

        let meeting_folder = manager.get_meeting_folder();
        let meeting_name = manager.get_meeting_name();

        match tokio::time::timeout(
            tokio::time::Duration::from_secs(300),
            manager.save_recording_only(&app)
        ).await {
            Ok(Ok(_)) => {
                info!("✅ Recording data saved successfully during cleanup");
            }
            Ok(Err(e)) => {
                warn!(
                    "⚠️ Error during recording cleanup (transcripts preserved): {}",
                    e
                );
            }
            Err(_) => {
                warn!("⏱️ File I/O timeout (5 minutes) reached during save, continuing shutdown");
            }
        }

        (meeting_folder, meeting_name)
    } else {
        info!("ℹ️ No recording manager available for cleanup");
        (None, None)
    };

    // La fase pasó a Stopping al inicio del flujo (ver arriba), por lo que el
    // loop de recording-audio-levels ya terminó. Aquí no hay flag que bajar.

    // Prepare metadata for frontend
    let (folder_path_str, meeting_name_str) = match (&meeting_folder, &meeting_name) {
        (Some(path), Some(name)) => (
            Some(path.to_string_lossy().to_string()),
            Some(name.clone()),
        ),
        _ => (None, None),
    };

    info!("📤 Preparing recording metadata for frontend save");
    info!("   folder_path: {:?}", folder_path_str);
    info!("   meeting_name: {:?}", meeting_name_str);

    info!("ℹ️ Skipping database save in Rust - frontend will save after all transcripts received");

    // Step 5: Complete shutdown
    let _ = app.emit(
        events::RECORDING_SHUTDOWN_PROGRESS,
        serde_json::json!({
            "stage": "complete",
            "message": "Recording stopped successfully",
            "progress": 100
        }),
    );

    // Stopping→Idle ANTES de anunciar el stop: cualquier código que reaccione a
    // recording-stopped (p. ej. re-arrancar) debe observar ya la fase Idle.
    drop(stop_gate);

    app.emit(
        events::RECORDING_STOPPED,
        serde_json::json!({
            "message": "Recording stopped - frontend will save after all transcripts received",
            "folder_path": folder_path_str,
            "meeting_name": meeting_name_str,
            "duration_seconds": captured_duration_seconds
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect stopped state
    crate::tray::update_tray_menu(&app);

    info!("🎉 Recording stopped successfully with ZERO transcript chunks lost");
    Ok(true)
}

// ============================================================================
// PAUSE / RESUME
// ============================================================================

/// Pause the current recording
#[tauri::command]
pub async fn pause_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    info!("Pausing recording");

    // Máquina-primero: gate y cambio de estado en una sola CAS (sin ventana
    // entre "¿está grabando?" y "pausar"). Doble pausa concurrente: solo una gana.
    recording_phase::try_transition(RecordingPhase::Recording, RecordingPhase::Paused)
        .map_err(|observed| format!("Cannot pause from phase '{}'", observed.as_str()))?;

    let manager_guard = RECORDING_MANAGER.lock().map_err(|e| format!("Recording manager lock poisoned: {}", e))?;
    if let Some(manager) = manager_guard.as_ref() {
        if let Err(e) = manager.pause_recording() {
            // El struct no pudo pausar: revertir la fase para no divergir.
            let _ = recording_phase::try_transition(RecordingPhase::Paused, RecordingPhase::Recording);
            return Err(e.to_string());
        }

        app.emit(
            events::RECORDING_PAUSED,
            serde_json::json!({
                "message": "Recording paused"
            }),
        )
        .map_err(|e| e.to_string())?;

        crate::tray::update_tray_menu(&app);

        // Recordatorio recurrente por si el usuario olvida que dejó la grabación en pausa.
        spawn_pause_reminder(app.clone());

        info!("Recording paused successfully");
        Ok(())
    } else {
        // Sin manager no hay nada que pausar: revertir la fase.
        let _ = recording_phase::try_transition(RecordingPhase::Paused, RecordingPhase::Recording);
        Err("No recording manager found".to_string())
    }
}

/// Resume the current recording
#[tauri::command]
pub async fn resume_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    info!("Resuming recording");

    // Paused→Recording en una sola CAS (gate + cambio de estado).
    recording_phase::try_transition(RecordingPhase::Paused, RecordingPhase::Recording)
        .map_err(|observed| format!("Cannot resume from phase '{}'", observed.as_str()))?;

    let manager_guard = RECORDING_MANAGER.lock().map_err(|e| format!("Recording manager lock poisoned: {}", e))?;
    if let Some(manager) = manager_guard.as_ref() {
        if let Err(e) = manager.resume_recording() {
            // El struct no pudo reanudar: revertir la fase para no divergir.
            let _ = recording_phase::try_transition(RecordingPhase::Recording, RecordingPhase::Paused);
            return Err(e.to_string());
        }

        app.emit(
            events::RECORDING_RESUMED,
            serde_json::json!({
                "message": "Recording resumed"
            }),
        )
        .map_err(|e| e.to_string())?;

        crate::tray::update_tray_menu(&app);

        info!("Recording resumed successfully");
        Ok(())
    } else {
        let _ = recording_phase::try_transition(RecordingPhase::Recording, RecordingPhase::Paused);
        Err("No recording manager found".to_string())
    }
}

/// Lanza una tarea de fondo que recuerda al usuario, cada `PAUSE_REMINDER_INTERVAL_SECS`,
/// que la grabación sigue en pausa. Vive en Rust para funcionar aunque la ventana esté
/// minimizada al tray. Se autocancela al reanudar/detener y un guard evita duplicados.
fn spawn_pause_reminder<R: Runtime>(app: AppHandle<R>) {
    // Si ya hay un recordatorio activo, no apilar otro.
    if PAUSE_REMINDER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut step: usize = 0;
        loop {
            let delay_secs = PAUSE_REMINDER_SCHEDULE_SECS
                .get(step)
                .copied()
                .unwrap_or(PAUSE_REMINDER_STEADY_SECS);
            step += 1;
            tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;

            // El booleano de pausa sale de la máquina (lock-free); el lock del
            // manager solo se toma para la duración, SIN sostenerlo por un await.
            let still_paused = recording_phase::current_phase() == RecordingPhase::Paused;
            let pause_secs = match RECORDING_MANAGER.lock() {
                Ok(guard) => guard
                    .as_ref()
                    .and_then(|manager| manager.get_current_pause_duration())
                    .unwrap_or(0.0),
                Err(_) => 0.0,
            };

            if !still_paused {
                break;
            }

            let minutes = (pause_secs / 60.0).floor() as u64;

            // Refuerzo in-app (broadcast a todas las ventanas): el toast del OS puede
            // ser suprimido por Windows (Focus Assist / compartir pantalla), así que el
            // estado también debe ser visible dentro de la propia UI.
            if let Err(e) = app.emit(
                events::RECORDING_PAUSED_REMINDER,
                serde_json::json!({ "minutes": minutes }),
            ) {
                warn!("[pause-reminder] emit in-app reminder failed: {}", e);
            }

            let notif_state = app.state::<crate::NotificationManagerState<R>>();
            let manager_guard = notif_state.read().await;
            if let Some(manager) = manager_guard.as_ref() {
                // Telemetría: si el DND del sistema está activo, el toast que sigue
                // probablemente no será visible para el usuario.
                if manager.get_system_dnd_status().await {
                    warn!(
                        "[pause-reminder] DND/Focus Assist activo — el toast de pausa ({} min) probablemente no es visible",
                        minutes
                    );
                }
                if let Err(e) = manager.show_recording_paused_reminder(minutes).await {
                    warn!("[pause-reminder] notification failed: {}", e);
                }
            }
        }

        PAUSE_REMINDER_RUNNING.store(false, Ordering::SeqCst);
    });
}
