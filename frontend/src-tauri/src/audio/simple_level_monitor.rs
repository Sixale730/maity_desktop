use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter, Runtime};
use anyhow::Result;
use log::{debug, error, info, warn};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use serde::Serialize;
use crate::events;

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
    /// Si el stream de micrófono está realmente abierto. Los consumidores
    /// existentes tipan estructuralmente e ignoran campos extra.
    pub mic_monitoring: bool,
}

/// Resultado de `start_monitoring`: qué streams quedaron realmente abiertos.
///
/// El frontend lo necesita porque el micrófono puede NO abrirse aunque se pida
/// (audífonos Bluetooth: abrirlo degradaría la reproducción del usuario), y la
/// UI tiene que reflejarlo en vez de dejar barras muertas que parecen un bug.
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStartResult {
    pub mic_active: bool,
    pub sys_active: bool,
}

/// Registro de consumidores del monitor.
///
/// REGISTRO POR OWNER (ago-2026) — reemplazó a un refcount simple.
///
/// El monitor es singleton y lo comparten varios consumidores (la home vía
/// `usePreviewLevels`, el selector de dispositivos, etc.). Un contador no
/// alcanzaba porque `start` y `stop` son comandos Tauri CONCURRENTES sin orden
/// garantizado: el cleanup de un efecto de React dispara `stop` sin esperar a
/// que resuelva el `start` en vuelo. Cuando el `stop` ganaba la carrera veía el
/// contador en 0, hacía no-op con un warn, y el `start` posterior dejaba el
/// **micrófono abierto para siempre sin ningún consumidor que pudiera
/// cerrarlo** (visto en logs de usuario: `refcount was already 0 (no-op)`).
///
/// Con owners nombrados, un `stop` sin `start` previo no es un error: deja un
/// *tombstone* y el `start` correspondiente lo consume y NO abre nada. Así el
/// stream ni siquiera llega a abrirse — mejor que abrirlo y cerrarlo 200 ms
/// después, que en Bluetooth provoca un flap de perfil audible.
#[derive(Default)]
struct MonitorOwners {
    /// owner_id → si ese consumidor quiere el stream de micrófono.
    active: HashMap<String, bool>,
    /// `stop` que llegaron antes que su `start` (cota FIFO para no crecer sin
    /// límite si algún caller sólo llama `stop`).
    tombstones: VecDeque<String>,
}

const MAX_TOMBSTONES: usize = 32;

static MONITOR_OWNERS: Lazy<Mutex<MonitorOwners>> =
    Lazy::new(|| Mutex::new(MonitorOwners::default()));

/// Toma el lock recuperándose del envenenamiento: un panic en otro hilo no debe
/// dejar el monitor inutilizable (convención del repo: nunca `.lock().unwrap()`).
fn owners() -> std::sync::MutexGuard<'static, MonitorOwners> {
    MONITOR_OWNERS.lock().unwrap_or_else(|poisoned| {
        warn!("MONITOR_OWNERS envenenado; recuperando el estado");
        poisoned.into_inner()
    })
}

/// Señales separadas por stream: el micrófono se puede apagar dejando vivo el
/// preview del sistema (loopback), que no toca el endpoint de captura y por lo
/// tanto no conmuta el perfil de unos audífonos Bluetooth.
static MIC_STREAM_ON: AtomicBool = AtomicBool::new(false);
static SYS_STREAM_ON: AtomicBool = AtomicBool::new(false);
/// "Hay emisor de eventos vivo" = mic || sys. Conserva el significado histórico
/// de `is_monitoring()` para sus consumidores externos.
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

/// Arranca el monitor de niveles para `owner_id`.
///
/// `want_mic == false` (o un micrófono Bluetooth, ver abajo) deja vivo sólo el
/// preview del audio del sistema. Idempotente por owner.
///
/// GATE BLUETOOTH: si el micrófono pedido es el de unos audífonos Bluetooth
/// clásicos con A2DP vivo, NO se abre. Abrirlo obligaría a Windows a conmutar
/// el headset a manos libres (mono, 16 kHz) y degradaría la música del usuario
/// — sólo para animar unas barritas, sin estar grabando nada. Ver
/// [`crate::audio::bluetooth_guard`].
pub async fn start_monitoring<R: Runtime>(
    app_handle: AppHandle<R>,
    owner_id: String,
    device_names: Vec<String>,
    want_mic: bool,
) -> Result<MonitorStartResult> {
    let mic_device_name = device_names.first().cloned().unwrap_or_default();

    // El sondeo del transporte va ANTES de tomar el lock: es I/O nativo con
    // timeout y jamás debe correr con el mutex tomado.
    let mic_allowed = if want_mic {
        // Nombre vacío = default del sistema; hay que resolverlo para poder
        // preguntar si ESE endpoint es Bluetooth.
        let probe_name = if mic_device_name.is_empty() {
            super::devices::default_input_device()
                .map(|d| d.name)
                .unwrap_or_default()
        } else {
            mic_device_name.clone()
        };
        if probe_name.is_empty() {
            true
        } else {
            !super::bluetooth_guard::should_avoid_opening_mic(&probe_name).await
        }
    } else {
        false
    };

    let (start_mic, start_sys, start_emitter) = {
        let mut guard = owners();

        // Un `stop` que llegó antes que este `start` (carrera del cleanup de
        // React): se consume el tombstone y no se abre nada.
        if let Some(pos) = guard.tombstones.iter().position(|id| id == &owner_id) {
            guard.tombstones.remove(pos);
            debug!("start_monitoring('{owner_id}'): tombstone consumido, no se abre nada");
            return Ok(MonitorStartResult { mic_active: false, sys_active: false });
        }

        guard.active.insert(owner_id.clone(), mic_allowed);

        let mic_needed = guard.active.values().any(|w| *w);
        let sys_needed = !guard.active.is_empty();

        let start_mic = mic_needed && !MIC_STREAM_ON.swap(true, Ordering::SeqCst);
        let start_sys = sys_needed && !SYS_STREAM_ON.swap(true, Ordering::SeqCst);
        let start_emitter = !IS_MONITORING.swap(true, Ordering::SeqCst);
        (start_mic, start_sys, start_emitter)
    };

    info!(
        "Audio level monitoring: owner='{}', mic={} (pedido={}), devices={:?}",
        owner_id, mic_allowed, want_mic, device_names
    );

    if start_mic {
        MIC_RMS.store(0u32, Ordering::Relaxed);
        MIC_PEAK.store(0u32, Ordering::Relaxed);
        spawn_mic_preview_thread(mic_device_name)?;
    }

    if start_sys {
        SYS_RMS.store(0u32, Ordering::Relaxed);
        SYS_PEAK.store(0u32, Ordering::Relaxed);
        // SYS PREVIEW THREAD (iter 11) ──────────────────────────────────────
        // Captura el output device default. Plataformas:
        // - Windows: CPAL `build_input_stream` sobre output device → WASAPI
        //   loopback shared mode automático ✓
        // - Linux: CPAL puede o no exponer "monitor source" — graceful skip.
        // - macOS (iter 12): CPAL no soporta loopback → CoreAudio tap directo.
        // Es captura del lado RENDER: no toca el endpoint de micrófono, así que
        // no conmuta el perfil de unos audífonos Bluetooth.
        spawn_sys_preview_thread()?;
    }

    if start_emitter {
        spawn_emitter_task(app_handle, device_names);
    }

    Ok(MonitorStartResult {
        mic_active: MIC_STREAM_ON.load(Ordering::SeqCst),
        sys_active: SYS_STREAM_ON.load(Ordering::SeqCst),
    })
}

/// Thread dueño del stream CPAL de micrófono (los streams no son Send en todas
/// las plataformas).
fn spawn_mic_preview_thread(mic_device_name: String) -> Result<()> {
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
                    MIC_STREAM_ON.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let device_name_actual = device.name().unwrap_or_else(|_| "Unknown".to_string());
            debug!("Monitoring input device: {}", device_name_actual);

            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to get input config for '{}': {}", device_name_actual, e);
                    MIC_STREAM_ON.store(false, Ordering::SeqCst);
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
                    MIC_STREAM_ON.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to build monitor stream: {}", e);
                    MIC_STREAM_ON.store(false, Ordering::SeqCst);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                error!("Failed to start monitor stream: {}", e);
                MIC_STREAM_ON.store(false, Ordering::SeqCst);
                return;
            }

            info!("Audio monitor stream started for '{}'", device_name_actual);

            // Keep thread alive while monitoring — stream is dropped when we exit
            while MIC_STREAM_ON.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            drop(stream);
            info!("Audio monitor stream stopped for '{}'", device_name_actual);
        })?;
    Ok(())
}

/// Task que publica los niveles al frontend cada 100 ms mientras haya algún
/// stream vivo.
fn spawn_emitter_task<R: Runtime>(app_handle: AppHandle<R>, device_names: Vec<String>) {
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
                // El mic puede estar cerrado a propósito (audífonos Bluetooth):
                // la UI lo usa para atenuar las barras en vez de mostrarlas
                // planas como si el micrófono estuviera roto.
                mic_monitoring: MIC_STREAM_ON.load(Ordering::SeqCst),
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

            if let Err(e) = app_handle.emit(events::AUDIO_LEVELS, &update) {
                error!("Failed to emit audio levels: {}", e);
                break;
            }
        }

        info!("Audio level emission task ended");
    });
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

            while SYS_STREAM_ON.load(Ordering::SeqCst) {
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

        while SYS_STREAM_ON.load(Ordering::SeqCst) {
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

/// Libera al consumidor `owner_id`. Los streams sólo se cierran cuando ya nadie
/// los necesita.
///
/// Un `stop` sin `start` previo NO es un error: deja un tombstone para que el
/// `start` en vuelo del mismo owner no abra nada (ver [`MonitorOwners`]).
pub async fn stop_monitoring(owner_id: String) -> Result<()> {
    let mut guard = owners();

    if guard.active.remove(&owner_id).is_none() {
        if guard.tombstones.len() >= MAX_TOMBSTONES {
            guard.tombstones.pop_front();
        }
        if !guard.tombstones.iter().any(|id| id == &owner_id) {
            guard.tombstones.push_back(owner_id.clone());
        }
        debug!("stop_monitoring('{owner_id}'): liberado antes del ack (tombstone)");
        return Ok(());
    }

    let mic_needed = guard.active.values().any(|w| *w);
    let sys_needed = !guard.active.is_empty();
    drop(guard);

    if !mic_needed && MIC_STREAM_ON.swap(false, Ordering::SeqCst) {
        // El último valor medido quedaría congelado y las barras se verían "a
        // media altura" para siempre.
        MIC_RMS.store(0u32, Ordering::Relaxed);
        MIC_PEAK.store(0u32, Ordering::Relaxed);
    }
    if !sys_needed && SYS_STREAM_ON.swap(false, Ordering::SeqCst) {
        SYS_RMS.store(0u32, Ordering::Relaxed);
        SYS_PEAK.store(0u32, Ordering::Relaxed);
    }
    if !mic_needed && !sys_needed {
        info!("Stopping audio level monitoring ('{owner_id}' era el último consumidor)");
        IS_MONITORING.store(false, Ordering::SeqCst);
    }
    Ok(())
}

/// Apagado incondicional: limpia el registro entero y cierra ambos streams.
///
/// Lo usa el hide-to-tray, que NO es un consumidor con `start` pareado — con la
/// API por owner, llamar `stop_monitoring` ahí le robaría el slot a otro.
pub async fn force_stop_all() -> Result<()> {
    {
        let mut guard = owners();
        guard.active.clear();
        guard.tombstones.clear();
    }
    MIC_STREAM_ON.store(false, Ordering::SeqCst);
    SYS_STREAM_ON.store(false, Ordering::SeqCst);
    IS_MONITORING.store(false, Ordering::SeqCst);
    MIC_RMS.store(0u32, Ordering::Relaxed);
    MIC_PEAK.store(0u32, Ordering::Relaxed);
    SYS_RMS.store(0u32, Ordering::Relaxed);
    SYS_PEAK.store(0u32, Ordering::Relaxed);
    info!("Audio level monitoring detenido por completo");
    Ok(())
}

/// Check if currently monitoring
pub fn is_monitoring() -> bool {
    IS_MONITORING.load(Ordering::SeqCst)
}
