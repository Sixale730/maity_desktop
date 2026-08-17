//! Catálogo de los eventos de telemetría emitidos DESDE Rust.
//!
//! Los nombres del ciclo de vida de grabación conservan el snake_case legacy
//! del emisor JS original (`recording_started`, no `recording.started`):
//! renombrarlos rompería la serie histórica en `maity.platform_logs`. Los
//! eventos NUEVOS (sin serie que preservar) usan dot-namespacing
//! (`device.profile`, `app.error`).

pub const RECORDING_STARTED: &str = "recording_started";
pub const RECORDING_START_FAILED: &str = "recording_start_failed";
pub const RECORDING_STOPPED: &str = "recording_stopped";
