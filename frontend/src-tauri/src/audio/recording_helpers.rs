// audio/recording_helpers.rs
//
// Shared helper functions for recording lifecycle operations.
// Extracted from recording_commands.rs to reduce duplication.

use log::{error, info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

use crate::events;

use cpal::traits::DeviceTrait;

use super::{
    default_input_device,
    default_output_device,
    RecordingManager,
};
use super::devices::{
    device_name_matcher, get_device_and_config, list_audio_devices, AudioDevice, DeviceType,
};

use super::transcription::{
    self,
    reset_speech_detected_flag,
    TranscriptUpdate,
};

use super::recording_lifecycle::{RECORDING_MANAGER, TRANSCRIPTION_TASK, TRANSCRIPT_LISTENER_ID};

// ── Watchdog de silencio de micrófono ───────────────────────────────────────
// Detecta un WAV mudo ANTES de que la reunión termine: WASAPI no reporta error
// cuando el perfil BT cambia (A2DP↔HFP) o el mic se mutea por hardware — el
// stream sigue "vivo" entregando ceros, o directamente deja de entregar chunks.

/// RMS por debajo del cual el mic se considera silencio digital absoluto
/// (-100 dBFS). El noise floor de un mic físico vivo (dither/ruido térmico)
/// nunca baja de ~1e-4; solo buffers de ceros exactos quedan debajo, así que
/// las pausas de conversación jamás disparan esto.
const MIC_SILENCE_RMS_THRESHOLD: f32 = 1e-5;
/// Segundos de RMS≈0 sostenido antes de alertar (modo "silent"). 15 s para no
/// molestar a quien mutea el mic deliberadamente unos segundos.
const MIC_SILENCE_ALERT_SECS: u32 = 15;
/// Segundos sin recibir NINGÚN chunk antes de alertar (modo "stalled"). No hay
/// causa legítima de 10 s sin chunks en grabación activa; absorbe con margen
/// la apertura del stream (~1-2 s) y el hot-swap de dispositivo (~2 s).
const MIC_STALL_ALERT_SECS: u32 = 10;
/// Debe coincidir con el interval de la task de niveles (100 ms).
const WATCHDOG_TICK_MS: u64 = 100;

/// Result of device resolution for recording
pub struct ResolvedDevices {
    pub microphone: Option<Arc<super::devices::AudioDevice>>,
    pub system_audio: Option<Arc<super::devices::AudioDevice>>,
}

/// Why we had to fall back from the user's preferred microphone to the
/// system default. Wired through the `microphone-fallback` event so the
/// frontend can show a tailored toast.
#[derive(Debug, Clone, Copy)]
pub enum DeviceFallbackReason {
    /// The parsed device is no longer in the live OS enumeration (USB
    /// unplugged between sessions, locale rename, driver change with no
    /// fuzzy match) — or the platform layer silently opened a different
    /// endpoint than the one requested.
    NotFound,
    /// `from_name_with_default_type` rejected the string (empty name after
    /// stripping). Rare in practice but worth distinguishing in the UI.
    InvalidFormat,
}

impl DeviceFallbackReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::InvalidFormat => "invalid_format",
        }
    }
}

/// Emit `microphone-fallback` so the frontend can surface a toast with the
/// device that was actually picked and why the preferred one was skipped.
fn emit_microphone_fallback<R: Runtime>(
    app: &AppHandle<R>,
    requested: &str,
    actual: &str,
    reason: DeviceFallbackReason,
) {
    let payload = serde_json::json!({
        "requested": requested,
        "actual": actual,
        "reason": reason.as_str(),
    });
    if let Err(e) = app.emit(events::MICROPHONE_FALLBACK, payload) {
        warn!("failed to emit microphone-fallback event: {}", e);
    }
}

/// Nombres de dispositivos de ENTRADA que en realidad son loopbacks de la salida
/// (no micrófonos). Grabar con uno de estos como "micrófono" significa que la voz
/// del usuario NO se captura y la atribución de hablantes L/R queda rota (reporte
/// usuario jul-2026: el default de Windows era "Mezcla estéreo (Realtek)" → 87 min
/// de jornada sin voz). Windows/Realtek localizan el nombre según el idioma del OS,
/// por eso hay variantes en español e inglés; "monitor of" cubre PulseAudio (Linux).
const LOOPBACK_INPUT_MARKERS: [&str; 7] = [
    "mezcla estéreo",
    "mezcla estereo",
    "stereo mix",
    "what u hear",
    "wave out",
    "loopback",
    "monitor of",
];

/// True si el nombre de un dispositivo de entrada corresponde a un loopback conocido.
fn is_loopback_like_input(name: &str) -> bool {
    let lower = name.to_lowercase();
    LOOPBACK_INPUT_MARKERS.iter().any(|m| lower.contains(m))
}

/// Preflight: avisa (log + evento `mic-loopback-warning` para toast) si el micrófono
/// con el que se va a grabar es un loopback. La grabación continúa — puede ser
/// intencional — pero el usuario debe saber que su voz no se capturará.
fn warn_if_loopback_mic<R: Runtime>(app: &AppHandle<R>, mic: &Option<Arc<AudioDevice>>) {
    if let Some(device) = mic {
        if is_loopback_like_input(&device.name) {
            warn!(
                "⚠️ El micrófono seleccionado parece un loopback del sistema: '{}' — la voz del usuario probablemente NO se grabará",
                device.name
            );
            let payload = serde_json::json!({ "device": device.name });
            if let Err(e) = app.emit(events::MIC_LOOPBACK_WARNING, payload) {
                warn!("failed to emit mic-loopback-warning event: {}", e);
            }
        }
    }
}

/// Returns true if `requested_name` matches any input device in the live
/// OS enumeration using the fuzzy matcher. Strips the trailing `(input)` /
/// `(Input)` suffix that preferences carry but enumerated names don't.
async fn input_device_exists(requested_name: &str) -> bool {
    let bare = requested_name
        .trim_end_matches(" (input)")
        .trim_end_matches(" (Input)")
        .trim();
    match list_audio_devices().await {
        Ok(devices) => devices.iter().any(|d| {
            d.device_type == DeviceType::Input
                && device_name_matcher::is_same_device(&d.name, bare)
        }),
        Err(e) => {
            // If enumeration fails we cannot prove the device is missing, so
            // we don't block the parsed device — the downstream stream-open
            // path will surface the real error if there is one.
            warn!(
                "input_device_exists: list_audio_devices failed ({}); skipping verification",
                e
            );
            true
        }
    }
}

/// Fall back to the system default microphone, emit `microphone-fallback`,
/// and return the resolved device. Returns Err only when the system has no
/// input devices at all.
fn fallback_to_default_mic<R: Runtime>(
    app: &AppHandle<R>,
    requested: &str,
    reason: DeviceFallbackReason,
) -> Result<Option<Arc<AudioDevice>>, String> {
    match default_input_device() {
        Ok(device) => {
            info!("✅ Falling back to default microphone: '{}'", device.name);
            emit_microphone_fallback(app, requested, &device.name, reason);
            Ok(Some(Arc::new(device)))
        }
        Err(default_err) => {
            error!("❌ No microphone available (preferred and default both failed)");
            emit_microphone_fallback(app, requested, "<none>", reason);
            Err(format!(
                "No microphone device available. Preferred '{}' not found and default unavailable: {}",
                requested, default_err
            ))
        }
    }
}

/// Preflight: resuelve el mismo endpoint que abrirá el stream real
/// (`get_device_and_config`) y devuelve el dispositivo con el nombre del
/// endpoint efectivamente abierto. En Windows la capa WASAPI
/// (`get_windows_device`) puede caer en silencio al default devolviendo `Ok`;
/// sin este preflight, el saver, el device monitor y el evento
/// `recording-started` reportan el nombre PEDIDO aunque se grabe de otro lado.
/// Adoptar el nombre enumerado también hace que los matchers exactos (`==`) de
/// `switch_audio_device` y `device_monitor` funcionen. Si el endpoint es
/// genuinamente otro dispositivo (no una mera variante del nombre), emite
/// `microphone-fallback` para que el usuario vea el toast.
async fn resolve_actual_endpoint<R: Runtime>(
    app: &AppHandle<R>,
    device: Arc<AudioDevice>,
    notify_fallback: bool,
) -> Arc<AudioDevice> {
    match get_device_and_config(&device).await {
        Ok((cpal_device, _config)) => match cpal_device.name() {
            Ok(actual_name) if actual_name != device.name => {
                if device_name_matcher::is_same_device(&actual_name, &device.name) {
                    info!(
                        "Nombre de endpoint normalizado: '{}' → '{}'",
                        device.name, actual_name
                    );
                } else {
                    warn!(
                        "⚠️ El endpoint abierto ('{}') NO es el pedido ('{}') — fallback silencioso de la capa de plataforma",
                        actual_name, device.name
                    );
                    if notify_fallback {
                        emit_microphone_fallback(
                            app,
                            &device.name,
                            &actual_name,
                            DeviceFallbackReason::NotFound,
                        );
                    }
                }
                Arc::new(AudioDevice::new(actual_name, device.device_type.clone()))
            }
            _ => device,
        },
        Err(e) => {
            warn!(
                "No se pudo verificar el endpoint para '{}': {} — se continúa con el nombre pedido",
                device.name, e
            );
            device
        }
    }
}

/// Resolve microphone device from preference name or fallback to default.
///
/// Validation stages when a preference is set:
///   1. `from_name_with_default_type` parses the saved string — canonical raw
///      name or legacy `(input)` / `(output)` suffixed format.
///   2. `input_device_exists` confirms the device is actually present in
///      the live enumeration (handles unplug, locale flip, driver rename).
///   3. `resolve_actual_endpoint` opens the endpoint the stream will use and
///      adopts its real name (catches the silent WASAPI default fallback).
///
/// On any failure we fall back to the system default mic and emit
/// `microphone-fallback` so the UI can show a clear toast instead of the
/// recording silently proceeding with the wrong device.
pub async fn resolve_microphone_from_preference<R: Runtime>(
    app: &AppHandle<R>,
    preferred_name: Option<String>,
) -> Result<Option<Arc<AudioDevice>>, String> {
    match preferred_name {
        Some(pref_name) => {
            info!("🎤 Attempting to use preferred microphone: '{}'", pref_name);
            match AudioDevice::from_name_with_default_type(&pref_name, DeviceType::Input) {
                Ok(device) if input_device_exists(&device.name).await => {
                    info!("✅ Using preferred microphone: '{}'", device.name);
                    Ok(Some(resolve_actual_endpoint(app, Arc::new(device), true).await))
                }
                Ok(device) => {
                    warn!(
                        "⚠️ Preferred microphone '{}' not present in current enumeration",
                        device.name
                    );
                    fallback_to_default_mic(app, &pref_name, DeviceFallbackReason::NotFound)
                }
                Err(e) => {
                    warn!("⚠️ Preferred microphone '{}' invalid format: {}", pref_name, e);
                    fallback_to_default_mic(app, &pref_name, DeviceFallbackReason::InvalidFormat)
                }
            }
        }
        None => {
            info!("🎤 No microphone preference set, using system default");
            match default_input_device() {
                Ok(device) => {
                    info!("✅ Using default microphone: '{}'", device.name);
                    Ok(Some(Arc::new(device)))
                }
                Err(e) => {
                    error!("❌ No default microphone available");
                    Err(format!("No microphone device available: {}", e))
                }
            }
        }
    }
}

/// Resolve system audio device from preference name or fallback to default
/// System audio is optional - returns None if unavailable
pub async fn resolve_system_audio_from_preference<R: Runtime>(
    app: &AppHandle<R>,
    preferred_name: Option<String>,
) -> Option<Arc<super::devices::AudioDevice>> {
    match preferred_name {
        Some(pref_name) => {
            info!("🔊 Attempting to use preferred system audio: '{}'", pref_name);
            match AudioDevice::from_name_with_default_type(&pref_name, DeviceType::Output) {
                Ok(device) => {
                    info!("✅ Using preferred system audio: '{}'", device.name);
                    Some(resolve_actual_endpoint(app, Arc::new(device), false).await)
                }
                Err(e) => {
                    warn!("⚠️ Preferred system audio '{}' not available: {}", pref_name, e);
                    warn!("   Falling back to system default...");
                    match default_output_device() {
                        Ok(device) => {
                            info!("✅ Using default system audio: '{}'", device.name);
                            Some(Arc::new(device))
                        }
                        Err(default_err) => {
                            warn!("⚠️ No system audio available (preferred and default both failed): {}", default_err);
                            warn!("   Recording will continue with microphone only");
                            None
                        }
                    }
                }
            }
        }
        None => {
            info!("🔊 No system audio preference set, using system default");
            match default_output_device() {
                Ok(device) => {
                    info!("✅ Using default system audio: '{}'", device.name);
                    Some(Arc::new(device))
                }
                Err(e) => {
                    warn!("⚠️ No default system audio available: {}", e);
                    warn!("   Recording will continue with microphone only");
                    None
                }
            }
        }
    }
}

/// Parse explicit device names into device handles. Accepts the canonical raw
/// name or the legacy suffixed format. The microphone goes through
/// `input_device_exists` so a stale name (USB unplugged, locale rename) falls
/// back to the system default and emits `microphone-fallback`. System audio is
/// optional: an unparseable name degrades to the default output (mirroring
/// `resolve_system_audio_from_preference`) instead of aborting the start.
/// Both resolved devices go through `resolve_actual_endpoint` so downstream
/// reporting carries the endpoint that will actually open.
pub async fn parse_explicit_devices<R: Runtime>(
    app: &AppHandle<R>,
    mic_device_name: &Option<String>,
    system_device_name: &Option<String>,
) -> Result<ResolvedDevices, String> {
    let microphone = if let Some(ref name) = mic_device_name {
        match AudioDevice::from_name_with_default_type(name, DeviceType::Input) {
            Ok(device) if input_device_exists(&device.name).await => {
                Some(resolve_actual_endpoint(app, Arc::new(device), true).await)
            }
            Ok(_) => fallback_to_default_mic(app, name, DeviceFallbackReason::NotFound)?,
            Err(_) => fallback_to_default_mic(app, name, DeviceFallbackReason::InvalidFormat)?,
        }
    } else {
        None
    };

    let system_audio = if let Some(ref name) = system_device_name {
        match AudioDevice::from_name_with_default_type(name, DeviceType::Output) {
            Ok(device) => Some(resolve_actual_endpoint(app, Arc::new(device), false).await),
            Err(e) => {
                warn!(
                    "⚠️ Invalid system device '{}': {} — falling back to default output",
                    name, e
                );
                match default_output_device() {
                    Ok(device) => {
                        info!("✅ Using default system audio: '{}'", device.name);
                        Some(Arc::new(device))
                    }
                    Err(default_err) => {
                        warn!(
                            "⚠️ No system audio available ({}) — recording will continue with microphone only",
                            default_err
                        );
                        None
                    }
                }
            }
        }
    } else {
        None
    };

    Ok(ResolvedDevices { microphone, system_audio })
}

/// Initialize recording manager, start recording, store global state, and register event listeners.
/// This is the shared core logic used by both start_recording variants.
///
/// Recibe el `StartGate` (fase Starting adquirida por el caller) y lo comitea
/// (Starting→Recording) en el punto exacto donde la sesión queda activa hacia
/// afuera. Si esta función retorna Err antes del commit, el Drop del gate
/// revierte a Idle.
pub async fn initialize_recording<R: Runtime>(
    app: &AppHandle<R>,
    microphone_device: Option<Arc<super::devices::AudioDevice>>,
    system_device: Option<Arc<super::devices::AudioDevice>>,
    meeting_name: Option<String>,
    auto_save: bool,
    start_gate: super::recording_phase::StartGate,
) -> Result<(), String> {
    // Preflight: embudo común de ambos start paths — cubre preferencia, default
    // del OS y dispositivos explícitos.
    warn_if_loopback_mic(app, &microphone_device);

    // Create new recording manager
    let mut manager = RecordingManager::new();

    // Load system audio gain from preferences
    if let Ok(prefs) = super::recording_preferences::load_recording_preferences(app).await {
        manager.system_audio_gain = prefs.system_audio_gain.clamp(0.5, 3.0);
        log::info!("🔊 System audio gain from preferences: {:.1}x", manager.system_audio_gain);
    }

    // Generate effective meeting name
    let effective_meeting_name = meeting_name.unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!(
            "Reunión {}",
            now.format("%Y-%m-%d_%H-%M-%S")
        )
    });
    manager.set_meeting_name(Some(effective_meeting_name));

    // Set up error callback. Si `session_stopped=true`, el struct ya detuvo la
    // captura internamente (error fatal o acumulación de errores): propagar el
    // stop COMPLETO — máquina de fases, drenaje de transcripción y guardado —
    // o el mundo exterior (tray/UI/scheduler) seguiría creyendo que graba.
    let app_for_error = app.clone();
    manager.set_error_callback(move |error, session_stopped| {
        let _ = app_for_error.emit(events::RECORDING_ERROR, error.user_message());
        if session_stopped {
            warn!("🛑 Error fatal de audio detuvo la sesión — lanzando stop_recording completo");
            let app_for_stop = app_for_error.clone();
            tauri::async_runtime::spawn(async move {
                // save_path se ignora en el flujo de stop (el manager deriva la
                // carpeta de la reunión por su cuenta).
                let args = super::recording_commands::RecordingArgs { save_path: String::new() };
                if let Err(e) = super::recording_lifecycle::stop_recording(app_for_stop, args).await {
                    error!("Auto-stop tras error fatal falló: {}", e);
                }
            });
        }
    });

    // Start recording with resolved devices
    let transcription_receiver = manager
        .start_recording(microphone_device, system_device, auto_save)
        .await
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    // Get a clone of the recording state for the level emission task
    let recording_state = manager.get_state().clone();

    // Store the manager globally to keep it alive
    {
        let mut global_manager = RECORDING_MANAGER.lock().map_err(|e| format!("Recording manager lock poisoned: {}", e))?;
        *global_manager = Some(manager);
    }

    // Starting→Recording: la sesión queda activa hacia afuera. Reset del flag
    // de speech detection para la nueva sesión.
    info!("🔍 Comiteando fase Recording y reseteando SPEECH_DETECTED_EMITTED");
    start_gate.commit()?;
    reset_speech_detected_flag();

    // Spawn audio level emission task — polls RecordingState atomics every 100ms
    {
        let app_for_levels = app.clone();
        let state_for_levels = recording_state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(WATCHDOG_TICK_MS));
            // Estado del watchdog de silencio — vive en el stack de la task,
            // muere con ella al terminar la grabación.
            let mut last_seq: u64 = state_for_levels.mic_chunk_seq();
            let mut silent_ticks: u32 = 0; // ticks consecutivos con chunks pero RMS≈0
            let mut stalled_ticks: u32 = 0; // ticks consecutivos sin chunks nuevos
            let mut alerted = false; // latch: una alerta por episodio
            let ticks_per_sec = (1000 / WATCHDOG_TICK_MS) as u32;
            loop {
                interval.tick().await;
                if !state_for_levels.is_recording() {
                    break;
                }
                let (mic_rms, mic_peak, sys_rms, sys_peak) = state_for_levels.get_audio_levels();
                let payload = serde_json::json!({
                    "micRms": mic_rms,
                    "micPeak": mic_peak,
                    "sysRms": sys_rms,
                    "sysPeak": sys_peak,
                });
                // Broadcast a propósito: NO migrar a emit_to por label. Los
                // listen() del frontend registran EventTarget::Any, que recibe
                // también los emit_to (verificado en tauri 2.11.2,
                // match_any_or_filter), así que emit_to no ahorra ningún wakeup
                // y en cambio serializa el payload una vez por label.
                let _ = app_for_levels.emit(events::RECORDING_AUDIO_LEVELS, payload);

                // ── Watchdog de silencio de micrófono ────────────────────────
                if state_for_levels.is_paused() {
                    // En pausa el silencio/stall es esperado: reset total.
                    silent_ticks = 0;
                    stalled_ticks = 0;
                    last_seq = state_for_levels.mic_chunk_seq();
                    continue;
                }
                let seq = state_for_levels.mic_chunk_seq();
                if seq == last_seq {
                    // Ningún chunk nuevo — mic_rms está STALE, no interpretarlo.
                    stalled_ticks += 1;
                    silent_ticks = 0;
                } else {
                    last_seq = seq;
                    stalled_ticks = 0;
                    if mic_rms < MIC_SILENCE_RMS_THRESHOLD {
                        silent_ticks += 1;
                    } else {
                        silent_ticks = 0;
                        if alerted {
                            // Volvió audio audible → rearmar el latch.
                            alerted = false;
                            info!("🎙️ Mic audio recovered — silence watchdog re-armed");
                        }
                    }
                }
                let (fired, mode, secs) = if stalled_ticks >= MIC_STALL_ALERT_SECS * ticks_per_sec {
                    (true, "stalled", stalled_ticks / ticks_per_sec)
                } else if silent_ticks >= MIC_SILENCE_ALERT_SECS * ticks_per_sec {
                    (true, "silent", silent_ticks / ticks_per_sec)
                } else {
                    (false, "", 0)
                };
                if fired && !alerted {
                    alerted = true;
                    let device = state_for_levels
                        .get_microphone_device()
                        .map(|d| d.name.clone());
                    warn!(
                        "🔇 Mic silence watchdog fired: mode={}, {}s sin audio, device={:?}",
                        mode, secs, device
                    );
                    let _ = app_for_levels.emit(
                        events::MIC_SILENCE_WARNING,
                        serde_json::json!({
                            "device": device,
                            "silenceSecs": secs,
                            "mode": mode,
                        }),
                    );
                }
            }
        });
    }

    // Si quedó viva una task de la sesión anterior (el stop la abandonó tras su
    // timeout), abortarla ANTES de spawnear la nueva: reset_session_counters()
    // pone CANCEL_PENDING=false y la resucitaría, dejando dos workers
    // compitiendo por CPU sobre el mismo engine con dos colas de chunks.
    {
        let mut global_task = TRANSCRIPTION_TASK.lock().map_err(|e| format!("Transcription task lock poisoned: {}", e))?;
        if let Some(old_task) = global_task.take() {
            if !old_task.is_finished() {
                log::warn!("Aborting leftover transcription task from previous session");
                old_task.abort();
            }
        }
    }

    // Start optimized parallel transcription task and store handle
    let task_handle = transcription::start_transcription_task(app.clone(), transcription_receiver);
    {
        let mut global_task = TRANSCRIPTION_TASK.lock().map_err(|e| format!("Transcription task lock poisoned: {}", e))?;
        *global_task = Some(task_handle);
    }

    // Register transcript-update event listener for history persistence
    register_transcript_listener(app);

    // Baseline de memoria al iniciar la sesión (comparar con post-stop-120s)
    crate::logging::mem_sampler::snapshot_now("recording-start");

    Ok(())
}

/// Register the transcript-update event listener that saves segments to the recording manager.
/// Stores the listener ID for cleanup during stop_recording.
fn register_transcript_listener<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Listener;
    let listener_id = app.listen(events::TRANSCRIPT_UPDATE, move |event: tauri::Event| {
        if let Ok(update) = serde_json::from_str::<TranscriptUpdate>(event.payload()) {
            let segment = crate::audio::recording_saver::TranscriptSegment {
                id: format!("seg_{}", update.sequence_id),
                text: update.text.clone(),
                audio_start_time: update.audio_start_time,
                audio_end_time: update.audio_end_time,
                duration: update.duration,
                display_time: update.timestamp.clone(),
                confidence: update.confidence,
                sequence_id: update.sequence_id,
                source_type: update.source_type.clone(),
            };

            if let Ok(manager_guard) = RECORDING_MANAGER.lock() {
                if let Some(manager) = manager_guard.as_ref() {
                    manager.add_transcript_segment(segment);
                }
            }
        }
    });
    match TRANSCRIPT_LISTENER_ID.lock() {
        Ok(mut global_listener) => {
            *global_listener = Some(listener_id);
            info!("✅ Transcript-update event listener registered for history persistence");
        }
        Err(e) => {
            warn!("⚠️ Failed to store transcript listener ID (lock poisoned): {}", e);
        }
    }
}

/// Validate that transcription models are ready before starting recording.
/// Emits an error event to the frontend if validation fails.
pub async fn validate_transcription_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    info!("🔍 Validating transcription model availability before starting recording...");
    if let Err(validation_error) = transcription::validate_transcription_model_ready(app).await {
        error!("Model validation failed: {}", validation_error);

        let _ = app.emit(events::TRANSCRIPTION_ERROR, serde_json::json!({
            "error": validation_error,
            "userMessage": "Recording cannot start: Transcription model is still downloading. Please wait for the download to complete.",
            "actionable": false
        }));

        return Err(validation_error);
    }
    info!("✅ Transcription model validation passed");
    Ok(())
}

/// Helper function to classify device type from device name (privacy-safe)
pub fn classify_device_type(device_name: &str) -> &'static str {
    let name_lower = device_name.to_lowercase();
    if name_lower.contains("bluetooth")
        || name_lower.contains("airpods")
        || name_lower.contains("beats")
        || name_lower.contains("headphones")
        || name_lower.contains("bt ")
        || name_lower.contains("wireless") {
        "Bluetooth"
    } else {
        "Wired"
    }
}
