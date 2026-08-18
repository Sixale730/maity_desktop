//! Catálogo de los eventos de telemetría del desktop — FUENTE DE VERDAD de los
//! nombres que llegan a `maity.platform_logs` (`event_type`), emita quien emita.
//!
//! Espejo exacto de `frontend/src/lib/telemetry-events.ts`; lo verifica
//! `frontend/scripts/lint-telemetry.js` en el pre-build. Regla: **evento nuevo =
//! 3 entradas** (esta constante, su gemela TS y una fila en
//! `docs/TELEMETRIA.md`). El lint también exige que todo call site de
//! `platformLogger.log` / `recordingLogService.log` use un nombre catalogado.
//!
//! Naming: los eventos NUEVOS usan dot-namespacing (`device.profile`,
//! `app.error`). Los que llevan el marcador `// legacy` conservan el snake_case
//! del emisor JS original: renombrarlos rompería la serie histórica en la
//! tabla. NO renombrar; el marcador es lo que el lint acepta como excepción a
//! la regla de naming.
//!
//! Aquí viven también nombres que hoy solo emite JS: el catálogo es el
//! contrato, no el uso. Por eso el `allow(dead_code)`.
#![allow(dead_code)]

// ── Ciclo de vida de grabación (emisor: Rust, chokepoint `initialize_recording`) ──
pub const RECORDING_STARTED: &str = "recording_started"; // legacy
pub const RECORDING_START_FAILED: &str = "recording_start_failed"; // legacy
pub const RECORDING_STOPPED: &str = "recording_stopped"; // legacy

// ── App / salud (emisor: platformLogger; `app.error` también Rust vía panics.rs) ──
pub const APP_OPEN: &str = "app.open";
pub const APP_CLOSE: &str = "app.close";
pub const APP_ERROR: &str = "app.error";
pub const HEALTH_HEARTBEAT: &str = "health.heartbeat";
pub const DEVICE_PROFILE: &str = "device.profile";
pub const NAV_PAGE_VIEW: &str = "nav.page_view";
pub const COACH_SESSION_SUMMARY: &str = "coach.session_summary";

// ── Guardado post-grabación (emisor: recordingLogService, outbox `recording_logs`) ──
pub const MEETING_ID_GENERATED: &str = "meeting_id_generated"; // legacy
pub const BUFFER_FLUSH_COMPLETED: &str = "buffer_flush_completed"; // legacy
pub const SQLITE_SAVE_ATTEMPTED: &str = "sqlite_save_attempted"; // legacy
pub const SQLITE_SAVE_SUCCEEDED: &str = "sqlite_save_succeeded"; // legacy
pub const SQLITE_SAVE_FAILED: &str = "sqlite_save_failed"; // legacy
pub const SAVE_DEFERRED_AUDIO_ONLY: &str = "save_deferred_audio_only"; // legacy
pub const SAVE_SKIPPED_NO_TRANSCRIPTS: &str = "save_skipped_no_transcripts"; // legacy
pub const CLOUD_SYNC_ENQUEUED: &str = "cloud_sync_enqueued"; // legacy
pub const CLOUD_SYNC_ENQUEUE_FAILED: &str = "cloud_sync_enqueue_failed"; // legacy
