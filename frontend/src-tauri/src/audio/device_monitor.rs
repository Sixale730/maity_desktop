// Audio device monitoring for disconnect/reconnect detection
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use anyhow::Result;
use log::{debug, info, warn, error};

use super::devices::{AudioDevice, snapshot_device_names};
use super::devices::device_name_matcher::is_same_device;
// `perf_debug!` llega por alcance textual desde lib.rs (definido antes de `mod audio`).

/// Device monitoring events
#[derive(Debug, Clone, PartialEq)]
pub enum DeviceEvent {
    /// A device that was in use has disconnected
    DeviceDisconnected {
        device_name: String,
        device_type: DeviceMonitorType,
    },
    /// A previously disconnected device has reconnected
    DeviceReconnected {
        device_name: String,
        device_type: DeviceMonitorType,
    },
    /// Device list has changed (new device added or removed)
    DeviceListChanged,
}

/// Type of device being monitored
#[derive(Debug, Clone, PartialEq)]
pub enum DeviceMonitorType {
    Microphone,
    SystemAudio,
}

/// Sondeo mientras falta algún dispositivo vigilado.
const INTERVAL_MISSING: Duration = Duration::from_secs(2);
/// Sondeo con todos los dispositivos vigilados presentes.
///
/// NO alargarlo "para ahorrar CPU": los umbrales de desconexión
/// (`MonitoredDevice::disconnect_threshold`) se cuentan en CICLOS, así que la
/// cadencia define cuánto tarda el usuario en ver el toast y la auto-reconexión.
/// El ahorro de #17 vino de abaratar el tick (`snapshot_device_names`, property
/// store sin `IAudioClient`), no de sondear menos.
const INTERVAL_HEALTHY: Duration = Duration::from_secs(5);

/// Monitor state for a single device
#[derive(Debug, Clone)]
struct MonitoredDevice {
    name: String,
    device_type: DeviceMonitorType,
    consecutive_missing: u32,
    is_bluetooth: bool,
}

impl MonitoredDevice {
    fn new(name: String, device_type: DeviceMonitorType) -> Self {
        // Heuristic: check if device name contains bluetooth-related keywords.
        // "bt" only counts as a standalone token to avoid false hits inside
        // longer words; "auriculares"/"hands-free" are how Windows in Spanish
        // labels BT headsets.
        let lower = name.to_lowercase();
        let is_bluetooth = lower.contains("airpods")
            || lower.contains("bluetooth")
            || lower.contains("wireless")
            || lower.contains("auriculares")
            || lower.contains("hands-free")
            || lower.contains("manos libres")
            || lower
                .split(|c: char| !c.is_ascii_alphanumeric())
                .any(|t| t == "bt");

        Self {
            name,
            device_type,
            consecutive_missing: 0,
            is_bluetooth,
        }
    }

    /// Get appropriate disconnect threshold based on device type
    fn disconnect_threshold(&self) -> u32 {
        // Bluetooth devices get more grace period (they can briefly disconnect)
        if self.is_bluetooth {
            3 // 3 polling cycles (6-15 seconds)
        } else {
            2 // 2 polling cycles (4-10 seconds)
        }
    }

}

/// Intervalo del siguiente sondeo. PURA.
fn next_interval(has_missing: bool) -> Duration {
    if has_missing {
        INTERVAL_MISSING
    } else {
        INTERVAL_HEALTHY
    }
}

/// Lógica de UN tick del monitor, PURA (sin WASAPI, sin canal, sin reloj) para
/// poder probarla con tablas. Devuelve los eventos a emitir, en orden.
///
/// `previous_count` es `None` en el primer tick: no hay contra qué comparar, así
/// que NO se emite `DeviceListChanged`. Antes `last_device_list` nacía vacío y el
/// primer tick emitía `0 → N`, que el frontend (`useRecordingStart.ts`) convertía
/// en el toast "Cambio en dispositivos de audio" a los ~2-4 s de CADA grabación
/// manual y de cada `switch_audio_device` — un artefacto de inicialización, no
/// una detección.
fn evaluate_tick(
    monitored_devices: &mut [MonitoredDevice],
    previous_count: Option<usize>,
    current_devices: &[AudioDevice],
) -> Vec<DeviceEvent> {
    let mut events = Vec::new();

    // Check if device list changed (sólo por tamaño, a propósito: comparar por
    // nombres dispararía un toast en cada re-emparejamiento BT, que renombra
    // el endpoint "(2- X)" → "(3- X)").
    if let Some(previous) = previous_count {
        if current_devices.len() != previous {
            debug!("Device list changed: {} -> {} devices", previous, current_devices.len());
            events.push(DeviceEvent::DeviceListChanged);
        }
    }

    // Check each monitored device. Fuzzy match (is_same_device) en vez
    // de igualdad exacta: Windows sube el índice BT "(2- ...)" → "(3- ...)"
    // en cada re-emparejamiento y el nombre exacto deja de existir.
    for monitored in monitored_devices.iter_mut() {
        let found_name = current_devices
            .iter()
            .find(|d| is_same_device(&d.name, &monitored.name))
            .map(|d| d.name.clone());

        if let Some(found_name) = found_name {
            // Device is present
            if monitored.consecutive_missing > 0 {
                // Device has reconnected! Emit the RE-ENUMERATED name —
                // es el que aceptan switch_audio_device y compañía.
                info!("✅ Device '{}' reconnected as '{}' after {} missing checks",
                      monitored.name, found_name, monitored.consecutive_missing);

                events.push(DeviceEvent::DeviceReconnected {
                    device_name: found_name.clone(),
                    device_type: monitored.device_type.clone(),
                });

                monitored.consecutive_missing = 0;
            }
            // Adopt the current enumeration name so future exact
            // consumers (switch matchers, logs) see the real endpoint.
            if found_name != monitored.name {
                monitored.name = found_name;
            }
        } else {
            // Device is missing
            monitored.consecutive_missing += 1;

            debug!("⚠️ Device '{}' missing for {} checks (threshold: {})",
                  monitored.name, monitored.consecutive_missing,
                  monitored.disconnect_threshold());

            // Only emit disconnect event once when threshold is reached
            if monitored.consecutive_missing == monitored.disconnect_threshold() {
                warn!("❌ Device '{}' ({:?}) disconnected!",
                      monitored.name, monitored.device_type);

                events.push(DeviceEvent::DeviceDisconnected {
                    device_name: monitored.name.clone(),
                    device_type: monitored.device_type.clone(),
                });
            }
        }
    }

    events
}

/// Audio device monitor that detects disconnects and reconnects
pub struct AudioDeviceMonitor {
    monitor_handle: Option<JoinHandle<()>>,
    event_sender: mpsc::UnboundedSender<DeviceEvent>,
    stop_signal: Arc<tokio::sync::Notify>,
}

impl AudioDeviceMonitor {
    /// Create a new device monitor
    pub fn new() -> (Self, mpsc::UnboundedReceiver<DeviceEvent>) {
        let (event_sender, event_receiver) = mpsc::unbounded_channel();
        let stop_signal = Arc::new(tokio::sync::Notify::new());

        (
            Self {
                monitor_handle: None,
                event_sender,
                stop_signal,
            },
            event_receiver,
        )
    }

    /// Start monitoring specified devices
    pub fn start_monitoring(
        &mut self,
        microphone: Option<Arc<AudioDevice>>,
        system_audio: Option<Arc<AudioDevice>>,
    ) -> Result<()> {
        if self.monitor_handle.is_some() {
            warn!("Device monitor already running");
            return Ok(());
        }

        // Notify NUEVO por arranque. `notify_one()` sin nadie esperando guarda
        // un permiso, así que un `stop_monitoring()` sobre un monitor que nunca
        // arrancó (o el `Drop`) dejaría un permiso que mataría ESTE loop en su
        // primer `notified()`. Un Notify fresco no arrastra nada.
        self.stop_signal = Arc::new(tokio::sync::Notify::new());

        let mut monitored_devices = Vec::new();

        if let Some(mic) = microphone {
            monitored_devices.push(MonitoredDevice::new(
                mic.name.clone(),
                DeviceMonitorType::Microphone,
            ));
            info!("🔍 Monitoring microphone: '{}' (Bluetooth: {})",
                  mic.name, monitored_devices.last().unwrap().is_bluetooth);
        }

        if let Some(sys) = system_audio {
            monitored_devices.push(MonitoredDevice::new(
                sys.name.clone(),
                DeviceMonitorType::SystemAudio,
            ));
            info!("🔍 Monitoring system audio: '{}' (Bluetooth: {})",
                  sys.name, monitored_devices.last().unwrap().is_bluetooth);
        }

        if monitored_devices.is_empty() {
            return Err(anyhow::anyhow!("No devices to monitor"));
        }

        let event_sender = self.event_sender.clone();
        let stop_signal = self.stop_signal.clone();

        let handle = tokio::spawn(async move {
            Self::monitor_loop(monitored_devices, event_sender, stop_signal).await;
        });

        self.monitor_handle = Some(handle);
        info!("✅ Device monitor started");
        Ok(())
    }

    /// Stop monitoring
    pub async fn stop_monitoring(&mut self) {
        info!("Stopping device monitor");
        self.stop_signal.notify_one();

        if let Some(handle) = self.monitor_handle.take() {
            let _ = handle.await;
        }

        info!("Device monitor stopped");
    }

    /// Main monitoring loop
    async fn monitor_loop(
        mut monitored_devices: Vec<MonitoredDevice>,
        event_sender: mpsc::UnboundedSender<DeviceEvent>,
        stop_signal: Arc<tokio::sync::Notify>,
    ) {
        let mut previous_count: Option<usize> = None;
        let mut check_interval = INTERVAL_MISSING; // primer sondeo a los 2 s

        loop {
            // Check for stop signal with timeout
            tokio::select! {
                _ = stop_signal.notified() => {
                    info!("Device monitor received stop signal");
                    break;
                }
                _ = tokio::time::sleep(check_interval) => {
                    // Continue with monitoring check
                }
            }

            // Snapshot LIGERO (nombre + tipo): en Windows lee sólo el property
            // store, sin activar el IAudioClient de ningún endpoint. NO volver a
            // `list_audio_devices()` aquí: en cpal `input_devices()` activa el
            // audio client de cada endpoint y eso a 5 s durante toda la jornada
            // era el hallazgo #17 de la auditoría de recursos.
            let started = std::time::Instant::now();
            let current_devices = match snapshot_device_names().await {
                Ok(devices) => devices,
                Err(e) => {
                    error!("Failed to list audio devices: {}", e);
                    continue;
                }
            };
            perf_debug!("device snapshot: {} endpoints en {:?}",
                        current_devices.len(), started.elapsed());

            for event in evaluate_tick(&mut monitored_devices, previous_count, &current_devices) {
                let _ = event_sender.send(event);
            }
            previous_count = Some(current_devices.len());

            // Adjust check interval based on device states
            // If any device is missing, check more frequently
            let has_missing = monitored_devices.iter().any(|d| d.consecutive_missing > 0);
            let next = next_interval(has_missing);
            if next != check_interval {
                debug!("Adjusting monitor interval to {:?}", next);
                check_interval = next;
            }
        }
    }
}

impl Default for AudioDeviceMonitor {
    fn default() -> Self {
        Self::new().0
    }
}

impl Drop for AudioDeviceMonitor {
    fn drop(&mut self) {
        // Signal stop
        self.stop_signal.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::devices::DeviceType;

    fn dev(name: &str, device_type: DeviceType) -> AudioDevice {
        AudioDevice::new(name.to_string(), device_type)
    }

    fn mic(name: &str) -> MonitoredDevice {
        MonitoredDevice::new(name.to_string(), DeviceMonitorType::Microphone)
    }

    #[test]
    fn test_bluetooth_detection() {
        let airpods = MonitoredDevice::new(
            "John's AirPods Pro".to_string(),
            DeviceMonitorType::Microphone,
        );
        assert!(airpods.is_bluetooth);
        assert_eq!(airpods.disconnect_threshold(), 3);

        let builtin = MonitoredDevice::new(
            "Built-in Microphone".to_string(),
            DeviceMonitorType::Microphone,
        );
        assert!(!builtin.is_bluetooth);
        assert_eq!(builtin.disconnect_threshold(), 2);
    }

    #[tokio::test]
    async fn test_monitor_creation() {
        let (mut monitor, _receiver) = AudioDeviceMonitor::new();
        assert!(monitor.monitor_handle.is_none());

        // Stop should be safe even if not started
        monitor.stop_monitoring().await;
    }

    /// El primer tick no tiene contra qué comparar: NO debe emitir
    /// `DeviceListChanged` (era el toast espurio "Cambio en dispositivos de
    /// audio" al arrancar cada grabación).
    #[test]
    fn primer_tick_no_emite_list_changed() {
        let mut monitored = vec![mic("Micrófono USB")];
        let current = vec![
            dev("Micrófono USB", DeviceType::Input),
            dev("Altavoces", DeviceType::Output),
        ];

        let events = evaluate_tick(&mut monitored, None, &current);

        assert!(events.is_empty(), "{events:?}");
        assert_eq!(monitored[0].consecutive_missing, 0);
    }

    /// Con tamaño previo conocido, sólo un cambio de tamaño emite el evento.
    #[test]
    fn list_changed_solo_con_tamano_previo_distinto() {
        let mut monitored = vec![mic("Micrófono USB")];
        let current = vec![
            dev("Micrófono USB", DeviceType::Input),
            dev("Altavoces", DeviceType::Output),
            dev("Auriculares", DeviceType::Output),
        ];

        assert_eq!(
            evaluate_tick(&mut monitored, Some(2), &current),
            vec![DeviceEvent::DeviceListChanged]
        );
        assert!(evaluate_tick(&mut monitored, Some(3), &current).is_empty());
    }

    /// La desconexión se emite UNA sola vez, exactamente al llegar al umbral
    /// (2 ciclos para un mic no-BT), y no se repite mientras siga ausente.
    #[test]
    fn disconnect_se_emite_una_vez_al_umbral() {
        let mut monitored = vec![mic("Micrófono USB")];
        let sin_mic = vec![dev("Altavoces", DeviceType::Output)];

        assert!(evaluate_tick(&mut monitored, Some(1), &sin_mic).is_empty());
        assert_eq!(monitored[0].consecutive_missing, 1);

        assert_eq!(
            evaluate_tick(&mut monitored, Some(1), &sin_mic),
            vec![DeviceEvent::DeviceDisconnected {
                device_name: "Micrófono USB".to_string(),
                device_type: DeviceMonitorType::Microphone,
            }]
        );

        assert!(evaluate_tick(&mut monitored, Some(1), &sin_mic).is_empty());
        assert_eq!(monitored[0].consecutive_missing, 3);
    }

    /// Un headset BT tiene un ciclo más de gracia: el umbral es 3.
    #[test]
    fn bluetooth_espera_tres_ciclos() {
        let mut monitored = vec![mic("Micrófono (2- Auriculares BT)")];
        let sin_mic: Vec<AudioDevice> = vec![];

        assert!(evaluate_tick(&mut monitored, Some(0), &sin_mic).is_empty());
        assert!(evaluate_tick(&mut monitored, Some(0), &sin_mic).is_empty());
        assert_eq!(evaluate_tick(&mut monitored, Some(0), &sin_mic).len(), 1);
    }

    /// Al volver, el evento lleva el nombre RE-enumerado (Windows sube el
    /// índice BT al re-emparejar) y el monitor lo adopta como nombre vigilado.
    #[test]
    fn reconnect_emite_nombre_reenumerado_y_lo_adopta() {
        let mut monitored = vec![mic("Micrófono (2- Auriculares BT)")];
        let sin_mic: Vec<AudioDevice> = vec![];
        assert!(evaluate_tick(&mut monitored, Some(0), &sin_mic).is_empty());
        assert_eq!(monitored[0].consecutive_missing, 1);

        let reenumerado = vec![dev("Micrófono (3- Auriculares BT)", DeviceType::Input)];
        let events = evaluate_tick(&mut monitored, Some(0), &reenumerado);

        assert_eq!(
            events,
            vec![
                DeviceEvent::DeviceListChanged,
                DeviceEvent::DeviceReconnected {
                    device_name: "Micrófono (3- Auriculares BT)".to_string(),
                    device_type: DeviceMonitorType::Microphone,
                },
            ]
        );
        assert_eq!(monitored[0].name, "Micrófono (3- Auriculares BT)");
        assert_eq!(monitored[0].consecutive_missing, 0);
    }

    /// La cadencia es parte del contrato de latencia (umbral en ciclos).
    #[test]
    fn next_interval_dos_segundos_faltando_cinco_sanos() {
        assert_eq!(next_interval(true), Duration::from_secs(2));
        assert_eq!(next_interval(false), Duration::from_secs(5));
    }
}
