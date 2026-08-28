use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::error;

use super::configuration::{AudioDevice, DeviceType};
use super::platform;

/// List all available audio devices on the system
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();

    // Platform-specific device enumeration
    let mut devices = {
        #[cfg(target_os = "windows")]
        {
            platform::configure_windows_audio(&host)?
        }

        #[cfg(target_os = "linux")]
        {
            platform::configure_linux_audio(&host)?
        }

        #[cfg(target_os = "macos")]
        {
            platform::configure_macos_audio(&host)?
        }
    };

    // Add any additional devices from the default host. `host.devices()`
    // enumerates inputs AND outputs, so classify by real capability instead
    // of assuming Output — a mislabeled input disappears from every mic list
    // in the UI and skews the permission check.
    if let Ok(other_devices) = host.devices() {
        for device in other_devices {
            if let Ok(name) = device.name() {
                if !devices.iter().any(|d| d.name == name) {
                    let device_type = if device.default_input_config().is_ok() {
                        DeviceType::Input
                    } else {
                        DeviceType::Output
                    };
                    devices.push(AudioDevice::new(name, device_type));
                }
            }
        }
    }

    Ok(devices)
}

/// Probe honesta del micrófono: abre y suelta un stream de captura corto.
///
/// `None` = el micrófono está listo. `Some(err)` = falla clasificada.
///
/// **Por qué abrir el stream y no contar dispositivos.** En Windows la
/// enumeración NO está bloqueada por la privacidad del SO: `IMMDeviceEnumerator`
/// lista el micrófono con normalidad y es `IAudioClient::Initialize` quien
/// devuelve `E_ACCESSDENIED` después. Un chequeo por conteo (lo que hacía
/// `usePermissionCheck`) reporta OK justo en el caso que más importa detectar.
///
/// **Dónde puede vivir esto.** En onboarding, ajustes y diagnóstico — NUNCA en
/// `initialize_recording`: un `build_input_stream` extra en el arranque toca el
/// pipeline de audio. Es la condición con la que se difirió B4 en el ciclo 0.2.57.
pub fn probe_microphone_access() -> Option<crate::audio::device_errors::AudioStartError> {
    use crate::audio::device_errors::{classify_device_error, AudioStartError};
    use log::info;

    let host = cpal::default_host();

    // Sin dispositivo por defecto no hay hardware: es un problema distinto del
    // permiso denegado y merece un mensaje distinto.
    let Some(device) = host.default_input_device() else {
        info!("[probe_microphone_access] no hay dispositivo de entrada por defecto");
        return Some(AudioStartError::MicNotFound);
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            info!("[probe_microphone_access] sin config de entrada: {}", e);
            return Some(classify_device_error(&e.to_string()));
        }
    };

    let stream = match device.build_input_stream(
        &config.into(),
        |_data: &[f32], _: &cpal::InputCallbackInfo| {},
        |err| error!("Error in audio stream: {}", err),
        None,
    ) {
        Ok(s) => s,
        Err(e) => {
            // Aquí aterriza el 0x80070005. Se clasifica por HRESULT, no por el
            // texto: Windows lo traduce.
            info!("[probe_microphone_access] no se pudo construir el stream: {}", e);
            return Some(classify_device_error(&e.to_string()));
        }
    };

    if let Err(e) = stream.play() {
        info!("[probe_microphone_access] no se pudo reproducir el stream: {}", e);
        return Some(classify_device_error(&e.to_string()));
    }

    // Margen para que aparezca el diálogo de permiso (macOS) y el stream corra.
    std::thread::sleep(std::time::Duration::from_millis(500));
    drop(stream);

    info!("[probe_microphone_access] micrófono disponible");
    None
}

/// Trigger audio permission request on platforms that require it
/// Returns Ok(true) if permission is granted, Ok(false) if denied, Err if something went wrong
///
/// Conserva la firma booleana porque el paso de permisos de macOS sólo necesita
/// saber si quedó concedido. El diagnóstico fino vive en `probe_microphone_access`.
pub fn trigger_audio_permission() -> Result<bool> {
    Ok(probe_microphone_access().is_none())
}