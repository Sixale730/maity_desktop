//! Meeting Detector Module
//!
//! Detects when meeting applications (Zoom, Teams, Google Meet) are running
//! and optionally prompts the user to start recording.

pub mod detector;
pub mod process_monitor;
pub mod settings;
pub mod commands;

/// Kill-switch del detector de reuniones (ago-2026).
///
/// Aun tras el rediseño anti-falsos-positivos de jul-2026 el detector siguió
/// disparando diálogos que no correspondían a reuniones reales, así que se
/// apaga por completo con este flag, independiente de `settings.enabled` (el
/// JSON en disco de usuarios existentes trae `enabled: true` y pisaría un
/// cambio de default). `MeetingDetector::start()` es el único choke point
/// (auto-start del `setup()` de lib.rs + comando `start_meeting_detector`), y
/// con el flag en `true` retorna `Ok(())` sin arrancar el loop.
///
/// NO borrar el módulo: `scheduled_recording/service.rs` reutiliza
/// `ProcessMonitor`. Para reactivar el detector basta poner `false` aquí y
/// volver a montar `<MeetingDetectionDialog />` en `app/layout.tsx`.
pub const DETECTOR_KILL_SWITCH: bool = true;

pub use detector::MeetingDetector;
pub use process_monitor::{MeetingApp, DetectedMeeting};
pub use settings::MeetingDetectorSettings;
pub use commands::*;
