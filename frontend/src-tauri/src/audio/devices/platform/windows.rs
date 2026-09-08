use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use log::{debug, info, warn};

use crate::audio::devices::configuration::{AudioDevice, DeviceType};
use crate::audio::devices::device_name_matcher::is_same_device;

use super::wasapi_com::{read_string_property, ComScope};
use windows::core::Interface;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eAll, eCapture, EDataFlow, IMMDevice, IMMDeviceEnumerator, IMMEndpoint, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// Open a CPAL input device and pick the best available stream config.
/// Preference order: F32 stereo → any F32 → first config.
fn open_input_device(
    device: cpal::Device,
    name: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig)> {
    if let Ok(default_config) = device.default_input_config() {
        return Ok((device, default_config));
    }
    warn!(
        "Default input config failed for '{}', falling back to supported configs",
        name
    );
    let supported = device
        .supported_input_configs()
        .map_err(|e| anyhow!("Could not enumerate supported configs for '{}': {}", name, e))?;
    let configs: Vec<_> = supported.collect();
    if configs.is_empty() {
        return Err(anyhow!("No supported input configurations for device '{}'", name));
    }
    for config in &configs {
        if config.sample_format() == cpal::SampleFormat::F32 && config.channels() == 2 {
            return Ok((device, config.with_max_sample_rate()));
        }
    }
    for config in &configs {
        if config.sample_format() == cpal::SampleFormat::F32 {
            return Ok((device, config.with_max_sample_rate()));
        }
    }
    let config = configs[0].with_max_sample_rate();
    info!("Using fallback input config for '{}': {:?}", name, config);
    Ok((device, config))
}

/// Configure Windows audio devices using WASAPI
pub fn configure_windows_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    // Get WASAPI devices
    if let Ok(wasapi_host) = cpal::host_from_id(cpal::HostId::Wasapi) {
        debug!("Using WASAPI host for Windows audio device enumeration");

        // Add output devices (including loopback)
        if let Ok(output_devices) = wasapi_host.output_devices() {
            for device in output_devices {
                if let Ok(name) = device.name() {
                    // For Windows, we need to mark output devices specifically for loopback
                    // info!("Found Windows output device: {}", name);
                    devices.push(AudioDevice::new(name.clone(), DeviceType::Output));
                }
            }
        } else {
            warn!("Failed to enumerate WASAPI output devices");
        }

        // Add input devices from WASAPI
        if let Ok(input_devices) = wasapi_host.input_devices() {
            for device in input_devices {
                if let Ok(name) = device.name() {
                    // info!("Found Windows input device: {}", name);
                    devices.push(AudioDevice::new(name.clone(), DeviceType::Input));
                }
            }
        } else {
            warn!("Failed to enumerate WASAPI input devices");
        }
    } else {
        warn!("Failed to create WASAPI host, falling back to default host");
    }

    // If WASAPI failed or returned no devices, try default host as fallback
    if devices.is_empty() {
        debug!("WASAPI device enumeration failed or returned no devices, falling back to default host");
        // Add regular input devices
        if let Ok(input_devices) = host.input_devices() {
            for device in input_devices {
                if let Ok(name) = device.name() {
                    // info!("Found fallback input device: {}", name);
                    devices.push(AudioDevice::new(name.clone(), DeviceType::Input));
                }
            }
        } else {
            warn!("Failed to enumerate input devices from default host");
        }

        // Add output devices
        if let Ok(output_devices) = host.output_devices() {
            for device in output_devices {
                if let Ok(name) = device.name() {
                    // info!("Found fallback output device: {}", name);
                    devices.push(AudioDevice::new(name.clone(), DeviceType::Output));
                }
            }
        } else {
            warn!("Failed to enumerate output devices from default host");
        }
    }

    // If we still have no devices, add default devices
    if devices.is_empty() {
        warn!("No audio devices found, adding default devices only");

        // Try to add default input device
        if let Some(device) = host.default_input_device() {
            if let Ok(name) = device.name() {
                // info!("Adding default input device: {}", name);
                devices.push(AudioDevice::new(name, DeviceType::Input));
            }
        }

        // Try to add default output device
        if let Some(device) = host.default_output_device() {
            if let Ok(name) = device.name() {
                // info!("Adding default output device: {}", name);
                devices.push(AudioDevice::new(name, DeviceType::Output));
            }
        }
    }

    debug!("Found {} Windows audio devices", devices.len());
    Ok(devices)
}

/// Get Windows device and configuration using WASAPI
pub fn get_windows_device(audio_device: &AudioDevice) -> Result<(cpal::Device, cpal::SupportedStreamConfig)> {
    let wasapi_host = cpal::host_from_id(cpal::HostId::Wasapi)
        .map_err(|e| anyhow!("Failed to create WASAPI host: {}", e))?;

    // Extract the base device name without the (input) or (output) suffix
    let base_name = if audio_device.name.ends_with(" (input)") {
        audio_device.name.trim_end_matches(" (input)")
    } else if audio_device.name.ends_with(" (output)") {
        audio_device.name.trim_end_matches(" (output)")
    } else {
        &audio_device.name
    };

    info!("Looking for Windows device with base name: {}", base_name);

    match audio_device.device_type {
        DeviceType::Input => {
            // Two-pass matching against the live WASAPI enumeration:
            //   1. Strict (byte-equal or `contains`) — the happy path with
            //      zero allocation, behaviour identical to before.
            //   2. Fuzzy (`is_same_device`) — only runs when strict misses,
            //      and tolerates locale-flipped diacritics, NBSP, re-plug
            //      `(2)` suffixes and driver renames (Logi → Logitech).
            // Both pass → fall through to the system default mic below.
            let mut enumerated: Vec<cpal::Device> = Vec::new();
            for device in wasapi_host.input_devices()? {
                if let Ok(name) = device.name() {
                    info!("Checking input device: {}", name);
                    if name == base_name || name.contains(base_name) {
                        return open_input_device(device, &name);
                    }
                }
                enumerated.push(device);
            }
            for device in enumerated {
                if let Ok(name) = device.name() {
                    if is_same_device(&name, base_name) {
                        info!(
                            "Fuzzy-matched input device: requested '{}' resolved to '{}'",
                            base_name, name
                        );
                        return open_input_device(device, &name);
                    }
                }
            }

            // If we didn't find a matching device, try the default input device as
            // fallback. WARN y no info: devolvemos Ok con OTRO dispositivo — el
            // preflight `resolve_actual_endpoint` detecta este caso comparando el
            // nombre del endpoint abierto contra el pedido y avisa al frontend.
            warn!(
                "⚠️ Requested input device '{}' not found in WASAPI enumeration — falling back to default input",
                base_name
            );
            if let Some(default_device) = wasapi_host.default_input_device() {
                if let Ok(name) = default_device.name() {
                    warn!("⚠️ Using default input device instead: '{}'", name);
                    if let Ok(config) = default_device.default_input_config() {
                        return Ok((default_device, config));
                    } else if let Ok(supported_configs) = default_device.supported_input_configs() {
                        if let Some(config) = supported_configs.into_iter().next() {
                            return Ok((default_device, config.with_max_sample_rate()));
                        }
                    }
                }
            }
        }
        DeviceType::Output => {
            for device in wasapi_host.output_devices()? {
                if let Ok(name) = device.name() {
                    info!("Checking output device: {}", name);
                    // Check if the device name contains our base name
                    if name == base_name || name.contains(base_name) {
                        // info!("Found matching output device: {}", name);

                        // For output devices, we want to use them in loopback mode
                        if let Ok(supported_configs) = device.supported_output_configs() {
                            let configs: Vec<_> = supported_configs.collect();
                            if configs.is_empty() {
                                warn!("No supported output configurations found for device: {}", name);
                            } else {
                                // info!("Found {} supported output configurations", configs.len());

                                // Try to find a config that supports f32 format with 2 channels (stereo)
                                for config in &configs {
                                    if config.sample_format() == cpal::SampleFormat::F32 && config.channels() == 2 {
                                        let config = config.with_max_sample_rate();
                                        info!("Using stereo F32 output config: {:?}", config);
                                        return Ok((device, config));
                                    }
                                }

                                // Then try any F32 format
                                for config in &configs {
                                    if config.sample_format() == cpal::SampleFormat::F32 {
                                        let config = config.with_max_sample_rate();
                                        // info!("Using F32 output config: {:?}", config);
                                        return Ok((device, config));
                                    }
                                }

                                // Finally, use the first available config
                                let config = configs[0].with_max_sample_rate();
                                // info!("Using fallback output config: {:?}", config);
                                return Ok((device, config));
                            }
                        } else {
                            warn!("Could not enumerate supported configurations for device: {}", name);
                        }

                        // If we couldn't get supported configs, try default
                        if let Ok(default_config) = device.default_output_config() {
                            // info!("Using default output config: {:?}", default_config);
                            return Ok((device, default_config));
                        }
                    }
                }
            }

            // If we didn't find a matching device, try the default output device as
            // fallback. WARN y no info: devolvemos Ok con OTRO dispositivo (ver
            // comentario del path de input).
            warn!(
                "⚠️ Requested output device '{}' not found in WASAPI enumeration — falling back to default output",
                base_name
            );
            if let Some(default_device) = wasapi_host.default_output_device() {
                if let Ok(name) = default_device.name() {
                    warn!("⚠️ Using default output device instead: '{}'", name);
                    if let Ok(config) = default_device.default_output_config() {
                        return Ok((default_device, config));
                    } else if let Ok(supported_configs) = default_device.supported_output_configs() {
                        if let Some(config) = supported_configs.into_iter().next() {
                            return Ok((default_device, config.with_max_sample_rate()));
                        }
                    }
                }
            }
        }
    }

    Err(anyhow!("Device not found or no compatible configuration available: {}", audio_device.name))
}

/// Dirección (captura/render) de un endpoint, vía `IMMEndpoint`. No activa nada.
unsafe fn data_flow_of(device: &IMMDevice) -> windows::core::Result<EDataFlow> {
    let endpoint: IMMEndpoint = device.cast()?;
    endpoint.GetDataFlow()
}

/// Snapshot de los endpoints ACTIVOS de WASAPI (nombre + dirección) leyendo
/// SOLO el property store: **nunca activa el `IAudioClient`** de ningún endpoint.
///
/// Existe porque `list_audio_devices()` no sirve para un sondeo periódico: en
/// cpal 0.15 `input_devices()`/`output_devices()` filtran con
/// `supported_input/output_configs()`, y en WASAPI eso activa un `IAudioClient`
/// por endpoint y hace `GetMixFormat` + varios `IsFormatSupported`. El monitor
/// de dispositivos pagaba DOS enumeraciones completas con activación de todos
/// los endpoints cada 5 s durante toda la jornada (#17 de la auditoría de
/// recursos) — y activaba 720 veces por hora el endpoint de captura de un
/// headset BT, justo lo que `bluetooth_guard.rs` existe para evitar.
///
/// El nombre es `PKEY_Device_FriendlyName`, la MISMA propiedad que lee
/// `cpal::Device::name()`, así que coincide byte a byte con lo que devuelve
/// `list_audio_devices()` y `switch_audio_device` sigue casando con `==`. Un
/// endpoint sin nombre o sin dirección legible se omite (no es un error).
pub fn snapshot_active_endpoints() -> Result<Vec<AudioDevice>> {
    // PRIMER local a propósito: Rust suelta en orden inverso, así que el scope
    // COM sobrevive a la colección y a cada IMMDevice/IMMEndpoint de abajo. Sólo
    // salen `String`s, nada COM escapa de la función.
    let _com = ComScope::enter();
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| anyhow!("No se pudo crear el enumerador WASAPI: {e:?}"))?;
        let collection = enumerator
            .EnumAudioEndpoints(eAll, DEVICE_STATE_ACTIVE)
            .map_err(|e| anyhow!("No se pudieron enumerar los endpoints activos: {e:?}"))?;
        let count = collection
            .GetCount()
            .map_err(|e| anyhow!("No se pudo contar los endpoints activos: {e:?}"))?;

        let mut devices = Vec::with_capacity(count as usize);
        for i in 0..count {
            let Ok(device) = collection.Item(i) else {
                continue;
            };
            let Some(name) = read_string_property(&device, &PKEY_Device_FriendlyName) else {
                debug!("snapshot_active_endpoints: endpoint {i} sin FriendlyName, se omite");
                continue;
            };
            let flow = match data_flow_of(&device) {
                Ok(flow) => flow,
                Err(e) => {
                    debug!("snapshot_active_endpoints: '{name}' sin data flow ({e:?}), se omite");
                    continue;
                }
            };
            let device_type = if flow == eCapture {
                DeviceType::Input
            } else {
                DeviceType::Output
            };
            devices.push(AudioDevice::new(name, device_type));
        }

        Ok(devices)
    }
}