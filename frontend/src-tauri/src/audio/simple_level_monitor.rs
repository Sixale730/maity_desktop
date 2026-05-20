use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Runtime};
use anyhow::Result;
use log::{debug, error, info, warn};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelData {
    pub device_name: String,
    pub device_type: String, // "input" or "output"
    pub rms_level: f32,     // RMS level (0.0 to 1.0)
    pub peak_level: f32,    // Peak level (0.0 to 1.0)
    pub is_active: bool,    // Whether audio is being detected
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelUpdate {
    pub timestamp: u64,
    pub levels: Vec<AudioLevelData>,
}

// Global monitoring state using atomics (lock-free, same pattern as RecordingState).
//
// REFCOUNT (iter 8): el monitor es singleton — múltiples consumidores (la home
// vía usePreviewLevels, el coach-float vía start_audio_level_monitoring) lo
// usan en paralelo. Antes, cuando un consumidor llamaba stop_monitoring(), el
// monitor moría globalmente y los otros consumidores se quedaban mudos. Con
// refcount, solo se detiene cuando todos lo liberaron.
static MONITOR_REFCOUNT: AtomicUsize = AtomicUsize::new(0);
static IS_MONITORING: AtomicBool = AtomicBool::new(false);
static MIC_RMS: AtomicU32 = AtomicU32::new(0);
static MIC_PEAK: AtomicU32 = AtomicU32::new(0);
// SYS_RMS/SYS_PEAK (iter 11): niveles del output device (loopback). Windows via
// WASAPI loopback, macOS via ScreenCaptureKit/CoreAudio, Linux graceful fail.
// Antes el sysRms en preview era siempre 0 — la barra verde solo se animaba
// durante grabación real. Ahora el monitor de niveles arranca también un
// stream del sistema (idle) para que el user vea la actividad del speaker
// (YouTube/Spotify/llamada en otro programa) antes de grabar.
static SYS_RMS: AtomicU32 = AtomicU32::new(0);
static SYS_PEAK: AtomicU32 = AtomicU32::new(0);

/// Start real CPAL audio level monitoring for the specified input device.
/// Spawns an OS thread to own the CPAL stream (may not be Send on all platforms)
/// and a tokio task to emit level events every 100ms.
///
/// REFCOUNT (iter 8): si ya hay un monitor corriendo (otro consumidor lo
/// arrancó), simplemente incrementa el contador y retorna sin reiniciar el
/// loop. Esto evita "matar" el monitor para otros consumidores. El primer
/// caller decide qué device se monitorea — los siguientes heredan el mismo
/// device (limitación aceptada para V8).
pub async fn start_monitoring<R: Runtime>(
    app_handle: AppHandle<R>,
    device_names: Vec<String>,
) -> Result<()> {
    let prev = MONITOR_REFCOUNT.fetch_add(1, Ordering::SeqCst);
    if prev > 0 {
        info!(
            "Audio monitor already running, sharing instance (refcount {} -> {})",
            prev, prev + 1
        );
        return Ok(());
    }
    info!(
        "Starting audio level monitoring (refcount 0 -> 1) for devices: {:?}",
        device_names
    );

    // Reset levels (mic + sys)
    MIC_RMS.store(0u32, Ordering::Relaxed);
    MIC_PEAK.store(0u32, Ordering::Relaxed);
    SYS_RMS.store(0u32, Ordering::Relaxed);
    SYS_PEAK.store(0u32, Ordering::Relaxed);

    IS_MONITORING.store(true, Ordering::SeqCst);

    let mic_device_name = device_names.first().cloned().unwrap_or_default();

    // Spawn OS thread for CPAL (streams may not be Send on all platforms)
    std::thread::Builder::new()
        .name("audio-level-monitor".to_string())
        .spawn(move || {
            let host = cpal::default_host();

            // Find the requested device or fall back to default input
            let device = if mic_device_name.is_empty() {
                host.default_input_device()
            } else {
                host.input_devices()
                    .ok()
                    .and_then(|mut devices| {
                        devices.find(|d| d.name().map(|n| n == mic_device_name).unwrap_or(false))
                    })
                    .or_else(|| {
                        warn!(
                            "Device '{}' not found, falling back to default input",
                            mic_device_name
                        );
                        host.default_input_device()
                    })
            };

            let device = match device {
                Some(d) => d,
                None => {
                    error!("No input device available for monitoring");
                    IS_MONITORING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let device_name_actual = device.name().unwrap_or_else(|_| "Unknown".to_string());
            debug!("Monitoring input device: {}", device_name_actual);

            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to get input config for '{}': {}", device_name_actual, e);
                    IS_MONITORING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let channels = config.channels();
            let sample_format = config.sample_format();
            let stream_config = StreamConfig {
                channels,
                sample_rate: config.sample_rate(),
                buffer_size: cpal::BufferSize::Default,
            };

            debug!(
                "Monitor stream config: {}Hz, {} ch, {:?}",
                config.sample_rate().0,
                channels,
                sample_format
            );

            // Build input stream based on sample format
            let stream = match sample_format {
                SampleFormat::F32 => {
                    let ch = channels;
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            compute_and_store_levels(data, ch);
                        },
                        |err| error!("Audio monitor stream error: {}", err),
                        None,
                    )
                }
                SampleFormat::I16 => {
                    let ch = channels;
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            // Convert i16 samples to f32 in-place
                            let f32_data: Vec<f32> =
                                data.iter().map(|&s| s as f32 / 32768.0).collect();
                            compute_and_store_levels(&f32_data, ch);
                        },
                        |err| error!("Audio monitor stream error: {}", err),
                        None,
                    )
                }
                SampleFormat::U16 => {
                    let ch = channels;
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            let f32_data: Vec<f32> =
                                data.iter().map(|&s| (s as f32 / 32768.0) - 1.0).collect();
                            compute_and_store_levels(&f32_data, ch);
                        },
                        |err| error!("Audio monitor stream error: {}", err),
                        None,
                    )
                }
                _ => {
                    error!("Unsupported sample format for monitoring: {:?}", sample_format);
                    IS_MONITORING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to build monitor stream: {}", e);
                    IS_MONITORING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                error!("Failed to start monitor stream: {}", e);
                IS_MONITORING.store(false, Ordering::SeqCst);
                return;
            }

            info!("Audio monitor stream started for '{}'", device_name_actual);

            // Keep thread alive while monitoring — stream is dropped when we exit
            while IS_MONITORING.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            drop(stream);
            info!("Audio monitor stream stopped for '{}'", device_name_actual);
        })?;

    // SYS PREVIEW THREAD (iter 11) ──────────────────────────────────────────
    // Captura el output device default. Plataformas:
    // - Windows: CPAL `build_input_stream` sobre output device → WASAPI loopback
    //   shared mode automático ✓
    // - Linux: CPAL puede o no exponer "monitor source" — graceful skip si no
    //   soporta build_input_stream.
    // - macOS (iter 12): CPAL no soporta loopback → usamos CoreAudio tap directo
    //   vía `CoreAudioCapture` (mismo path que la grabación real). Esto requiere
    //   el permiso "Audio Capture" (NSAudioCaptureUsageDescription, ya presente
    //   en Info.plist). Si el permiso no está concedido, el tap retorna silencio
    //   y SYS_RMS queda en 0 (graceful degrade).
    spawn_sys_preview_thread()?;

    // Spawn tokio task to poll atomics and emit Tauri events
    let emit_device_name = device_names
        .first()
        .cloned()
        .unwrap_or_else(|| "Default".to_string());

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));

        while IS_MONITORING.load(Ordering::SeqCst) {
            interval.tick().await;

            let mic_rms = f32::from_bits(MIC_RMS.load(Ordering::Relaxed));
            let mic_peak = f32::from_bits(MIC_PEAK.load(Ordering::Relaxed));
            let sys_rms = f32::from_bits(SYS_RMS.load(Ordering::Relaxed));
            let sys_peak = f32::from_bits(SYS_PEAK.load(Ordering::Relaxed));

            let update = AudioLevelUpdate {
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                levels: vec![
                    AudioLevelData {
                        device_name: emit_device_name.clone(),
                        device_type: "input".to_string(),
                        rms_level: mic_rms,
                        peak_level: mic_peak,
                        is_active: mic_rms > 0.001,
                    },
                    // Output level siempre emitido. En Linux y casos de
                    // permiso denegado queda en 0 perpetuamente (el thread
                    // sys salió temprano). En Windows/macOS refleja el speaker.
                    AudioLevelData {
                        device_name: "System Audio".to_string(),
                        device_type: "output".to_string(),
                        rms_level: sys_rms,
                        peak_level: sys_peak,
                        is_active: sys_rms > 0.001,
                    },
                ],
            };

            if let Err(e) = app_handle.emit("audio-levels", &update) {
                error!("Failed to emit audio levels: {}", e);
                break;
            }
        }

        info!("Audio level emission task ended");
    });

    Ok(())
}

/// Spawn del thread que actualiza SYS_RMS/SYS_PEAK. Cross-platform wrapper.
///
/// - Windows/Linux: CPAL `build_input_stream` sobre el default output device.
///   En Windows esto activa WASAPI loopback automáticamente. En Linux depende de
///   si PulseAudio expone un "monitor source"; si no, graceful skip.
/// - macOS: CoreAudio tap directo (CPAL no soporta loopback en macOS).
#[cfg(not(target_os = "macos"))]
fn spawn_sys_preview_thread() -> Result<()> {
    std::thread::Builder::new()
        .name("audio-level-monitor-sys".to_string())
        .spawn(move || {
            let host = cpal::default_host();
            let output_device = match host.default_output_device() {
                Some(d) => d,
                None => {
                    info!("Sys preview: no default output device, skipping");
                    return;
                }
            };

            let device_name_actual = output_device
                .name()
                .unwrap_or_else(|_| "Unknown Output".to_string());
            debug!("Monitoring output device: {}", device_name_actual);

            let config = match output_device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    info!(
                        "Sys preview: failed to get output config for '{}': {} (graceful skip)",
                        device_name_actual, e
                    );
                    return;
                }
            };

            let channels = config.channels();
            let sample_format = config.sample_format();
            let stream_config = StreamConfig {
                channels,
                sample_rate: config.sample_rate(),
                buffer_size: cpal::BufferSize::Default,
            };

            debug!(
                "Sys monitor config: {}Hz, {} ch, {:?}",
                config.sample_rate().0,
                channels,
                sample_format
            );

            let stream_result = match sample_format {
                SampleFormat::F32 => {
                    let ch = channels;
                    output_device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            compute_and_store_sys_levels_from_interleaved(data, ch);
                        },
                        |err| debug!("Sys monitor stream error (non-fatal): {}", err),
                        None,
                    )
                }
                SampleFormat::I16 => {
                    let ch = channels;
                    output_device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            let f32_data: Vec<f32> =
                                data.iter().map(|&s| s as f32 / 32768.0).collect();
                            compute_and_store_sys_levels_from_interleaved(&f32_data, ch);
                        },
                        |err| debug!("Sys monitor stream error (non-fatal): {}", err),
                        None,
                    )
                }
                _ => {
                    info!(
                        "Sys preview: unsupported sample format {:?} (graceful skip)",
                        sample_format
                    );
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    info!(
                        "Sys preview: loopback not available for '{}': {} (graceful skip)",
                        device_name_actual, e
                    );
                    return;
                }
            };

            if let Err(e) = stream.play() {
                info!("Sys preview: failed to start stream: {} (graceful skip)", e);
                return;
            }

            info!("Sys audio preview stream started for '{}'", device_name_actual);

            while IS_MONITORING.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            drop(stream);
            info!("Sys audio preview stream stopped for '{}'", device_name_actual);
        })?;
    Ok(())
}

/// macOS: usa `CoreAudioCapture` (process tap + aggregate device) — la misma
/// infraestructura que la grabación real (`stream::AudioStream::create_core_audio_stream`).
/// El stream entrega samples f32 mono async; los agrupamos en ventanas de ~1024
/// samples para calcular RMS/peak y actualizar SYS_RMS/SYS_PEAK.
///
/// Permiso "Audio Capture": al ser primer arranque del tap puede gatillar el
/// diálogo del sistema. Si el usuario rechaza, `CoreAudioCapture::new()` aún
/// puede tener éxito pero el tap entrega silencio → SYS_RMS queda en 0
/// (graceful degrade, sin error visible al usuario).
#[cfg(target_os = "macos")]
fn spawn_sys_preview_thread() -> Result<()> {
    use crate::audio::capture::CoreAudioCapture;
    use futures_util::StreamExt;

    tokio::spawn(async move {
        let capture = match CoreAudioCapture::new() {
            Ok(c) => c,
            Err(e) => {
                info!(
                    "Sys preview (macOS): CoreAudioCapture::new() failed: {} (graceful skip)",
                    e
                );
                return;
            }
        };

        let mut stream = match capture.stream() {
            Ok(s) => s,
            Err(e) => {
                info!(
                    "Sys preview (macOS): stream() failed: {} (graceful skip)",
                    e
                );
                return;
            }
        };

        info!(
            "Sys audio preview started (macOS, CoreAudio tap @ {} Hz)",
            stream.sample_rate()
        );

        // Ventana de ~1024 samples (~21ms @ 48kHz) — balance entre latencia de
        // actualización del medidor (visualmente fluido) y costo de RMS por window.
        const WINDOW_SIZE: usize = 1024;
        let mut window: Vec<f32> = Vec::with_capacity(WINDOW_SIZE);

        while IS_MONITORING.load(Ordering::SeqCst) {
            match stream.next().await {
                Some(sample) => {
                    window.push(sample);
                    if window.len() >= WINDOW_SIZE {
                        // Mono — channels=1 porque el tap es global mono.
                        compute_and_store_sys_levels_from_interleaved(&window, 1);
                        window.clear();
                    }
                }
                None => {
                    info!("Sys preview (macOS): stream ended, exiting");
                    break;
                }
            }
        }

        // Drenar última ventana parcial (mantiene última medición consistente).
        if !window.is_empty() {
            compute_and_store_sys_levels_from_interleaved(&window, 1);
        }

        info!("Sys audio preview stopped (macOS)");
    });

    Ok(())
}

/// Compute RMS and peak para output (sys) data interleaved y store en SYS atomics.
/// Análogo a `compute_and_store_levels` (mic) pero target los atómicos de sistema.
/// CPAL entrega data interleaved cuando channels > 1, así que primero downmixeamos
/// a mono promediando cada frame.
fn compute_and_store_sys_levels_from_interleaved(data: &[f32], channels: u16) {
    if data.is_empty() {
        return;
    }

    // Downmix interleaved → mono (promedio por frame)
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    if mono.is_empty() {
        return;
    }

    let rms = (mono.iter().map(|x| x * x).sum::<f32>() / mono.len() as f32)
        .sqrt()
        .min(1.0);
    let peak = mono
        .iter()
        .map(|x| x.abs())
        .fold(0.0f32, f32::max)
        .min(1.0);

    SYS_RMS.store(rms.to_bits(), Ordering::Relaxed);
    SYS_PEAK.store(peak.to_bits(), Ordering::Relaxed);
}

/// Compute RMS and peak from audio data and store in atomics
fn compute_and_store_levels(data: &[f32], channels: u16) {
    if data.is_empty() {
        return;
    }

    // Convert to mono by averaging channels
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    if mono.is_empty() {
        return;
    }

    let rms = (mono.iter().map(|x| x * x).sum::<f32>() / mono.len() as f32)
        .sqrt()
        .min(1.0);
    let peak = mono
        .iter()
        .map(|x| x.abs())
        .fold(0.0f32, f32::max)
        .min(1.0);

    MIC_RMS.store(rms.to_bits(), Ordering::Relaxed);
    MIC_PEAK.store(peak.to_bits(), Ordering::Relaxed);
}

/// Stop audio level monitoring.
///
/// REFCOUNT (iter 8): decrementa el contador. Solo detiene el loop cuando
/// el contador llega a 0 (último consumidor liberó). Si todavía hay otros
/// consumidores (refcount > 0 después del decrement), mantiene el monitor
/// corriendo.
pub async fn stop_monitoring() -> Result<()> {
    let prev = MONITOR_REFCOUNT.load(Ordering::SeqCst);
    if prev == 0 {
        // Underflow defense: stop_monitoring llamado sin start_monitoring
        // previo. No hacemos nada — refcount ya está en 0.
        warn!("stop_monitoring called but refcount was already 0 (no-op)");
        return Ok(());
    }
    let new_count = MONITOR_REFCOUNT.fetch_sub(1, Ordering::SeqCst) - 1;
    if new_count == 0 {
        info!("Stopping audio level monitoring (refcount 1 -> 0)");
        IS_MONITORING.store(false, Ordering::SeqCst);
        // Reset levels to zero (mic + sys)
        MIC_RMS.store(0u32, Ordering::Relaxed);
        MIC_PEAK.store(0u32, Ordering::Relaxed);
        SYS_RMS.store(0u32, Ordering::Relaxed);
        SYS_PEAK.store(0u32, Ordering::Relaxed);
    } else {
        info!(
            "Audio monitor still in use by other consumers (refcount {} -> {})",
            new_count + 1,
            new_count
        );
    }
    Ok(())
}

/// Check if currently monitoring
pub fn is_monitoring() -> bool {
    IS_MONITORING.load(Ordering::SeqCst)
}
