use anyhow::{anyhow, Result};
use cpal::traits::{HostTrait, DeviceTrait};
use log::{info, warn};

use super::configuration::{AudioDevice, DeviceType};

/// Get the default input (microphone) device for the system
pub fn default_input_device() -> Result<AudioDevice> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("No default input device found"))?;
    Ok(AudioDevice::new(device.name()?, DeviceType::Input))
}

/// Find the built-in microphone device (wired, stable, consistent sample rate)
///
/// Searches for MacBook/built-in microphone patterns to find the hardware
/// microphone instead of Bluetooth devices. This is useful for:
/// - Avoiding Bluetooth variable sample rate issues
/// - Getting stable wired audio for recording
/// - Fallback when Bluetooth device is default but unreliable
///
/// Returns None if no built-in microphone found
pub fn find_builtin_input_device() -> Result<Option<AudioDevice>> {
    let host = cpal::default_host();

    // Built-in microphone name patterns (platform-specific)
    let builtin_patterns = [
        // macOS patterns
        "macbook",
        "built-in microphone",
        "internal microphone",
        // Windows patterns
        "microphone array",
        "realtek",
        "conexant",
        // Linux patterns
        "hda intel",
        "built-in audio",
    ];

    // Search all input devices for built-in pattern matches
    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            let name_lower = name.to_lowercase();

            // Check if this is a built-in device
            for pattern in &builtin_patterns {
                if name_lower.contains(pattern) {
                    // Additional filter: exclude Bluetooth/wireless devices
                    if name_lower.contains("bluetooth") ||
                       name_lower.contains("airpods") ||
                       name_lower.contains("wireless") {
                        continue; // Skip Bluetooth devices
                    }

                    info!("🎤 Found built-in microphone: '{}'", name);
                    return Ok(Some(AudioDevice::new(name, DeviceType::Input)));
                }
            }
        }
    }

    warn!("⚠️ No built-in microphone found (searched {} patterns)", builtin_patterns.len());
    Ok(None)
}

/// Dispositivos de entrada VIRTUALES (cables de software). No son loopbacks del
/// sistema, así que `is_loopback_like_input` no los cubre, y `InputDeviceKind`
/// los clasifica como `Wired` — sin este filtro serían candidatos "válidos" para
/// sustituir un micrófono Bluetooth y grabaríamos silencio durante horas.
const VIRTUAL_INPUT_MARKERS: [&str; 8] = [
    "vb-audio",
    "cable output",
    "voicemeeter",
    "virtual", // cubre "Oculus Virtual Audio Device", "VB-Audio Virtual Cable"…
    "blackhole",
    // Micrófonos de streaming/remote play: el endpoint existe siempre pero sólo
    // entrega audio cuando hay una sesión remota activa. Encontrados en una
    // máquina real (ago-2026) conviviendo con los Bluetooth del reporte, donde
    // podían salir elegidos como sustituto y grabar horas de silencio.
    "steam streaming",
    "nvidia broadcast",
    "oculus",
];

fn is_virtual_input(name: &str) -> bool {
    let lower = name.to_lowercase();
    VIRTUAL_INPUT_MARKERS.iter().any(|m| lower.contains(m))
}

/// Busca un micrófono REAL que no sea Bluetooth, para sustituir al de unos
/// audífonos BT y no forzar la conmutación A2DP→HFP (ver [`crate::audio::bluetooth_guard`]).
///
/// `exclude` es el nombre del micrófono Bluetooth que estamos evitando.
///
/// Filtros (el orden importa, cada uno tapa una regresión concreta):
/// 1. Sólo entradas.
/// 2. Se descarta el propio `exclude` con el matcher DIFUSO — nunca `==`:
///    Windows sube el índice del dispositivo (`(2- …)` → `(3- …)`) en cada
///    re-emparejamiento del headset.
/// 3. Se descartan loopbacks del sistema ("Mezcla estéreo", "Stereo Mix"…):
///    grabar con uno significa NO capturar la voz del usuario (regresión real
///    de jul-2026, 87 min de jornada sin voz).
/// 4. Se descartan cables virtuales (VB-Audio, VoiceMeeter…), por lo mismo.
/// 5. Se descartan otros dispositivos Bluetooth, con detección NATIVA de
///    transporte (no por nombre: el usuario puede haberlos renombrado).
///
/// Ranking determinista — la jornada dura todo el día, la elección no puede
/// bailar entre arranques: default del sistema → micrófono integrado → primero
/// en orden de enumeración.
///
/// Devuelve `None` si no sobrevive ningún candidato; el caller debe entonces
/// grabar con el Bluetooth igual (nunca fallar el arranque por esto).
pub async fn find_non_bluetooth_input_device(exclude: &str) -> Option<AudioDevice> {
    use crate::audio::bluetooth_guard;
    use crate::audio::devices::device_name_matcher;
    use crate::audio::recording_helpers::is_loopback_like_input;

    let devices = match super::discovery::list_audio_devices().await {
        Ok(devices) => devices,
        Err(e) => {
            warn!("No se pudieron enumerar dispositivos para buscar un micrófono alterno: {e}");
            return None;
        }
    };

    let mut candidates: Vec<String> = devices
        .into_iter()
        .filter(|d| d.device_type == DeviceType::Input)
        .map(|d| d.name)
        .filter(|name| !device_name_matcher::is_same_device(name, exclude))
        .filter(|name| !is_loopback_like_input(name))
        .filter(|name| !is_virtual_input(name))
        .collect();

    if candidates.is_empty() {
        return None;
    }

    // Ranking: el default del sistema primero, luego el integrado. Se resuelven
    // ANTES del sondeo de transporte para no pagar consultas nativas de más.
    let default_name = default_input_device().ok().map(|d| d.name);
    let builtin_name = find_builtin_input_device().ok().flatten().map(|d| d.name);

    candidates.sort_by_key(|name| {
        let is_default = default_name
            .as_deref()
            .is_some_and(|d| device_name_matcher::is_same_device(name, d));
        let is_builtin = builtin_name
            .as_deref()
            .is_some_and(|b| device_name_matcher::is_same_device(name, b));
        match (is_default, is_builtin) {
            (true, _) => 0,
            (_, true) => 1,
            _ => 2,
        }
    });

    for name in candidates {
        if bluetooth_guard::input_transport(&name).await == bluetooth_guard::BtTransport::Classic {
            info!("🎧 Descartado '{name}' como alterno: también es Bluetooth");
            continue;
        }
        info!("🎤 Micrófono alterno no-Bluetooth elegido: '{name}'");
        return Some(AudioDevice::new(name, DeviceType::Input));
    }

    warn!("⚠️ No hay ningún micrófono no-Bluetooth disponible como alterno");
    None
}