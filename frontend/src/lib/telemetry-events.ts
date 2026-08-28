/**
 * Catálogo de eventos de telemetría del desktop — espejo EXACTO de
 * `src-tauri/src/logging/telemetry/catalog.rs` (fuente de verdad de los
 * `event_type` que llegan a `maity.platform_logs`).
 *
 * Lo verifica `scripts/lint-telemetry.js` en el pre-build:
 *  - los dos catálogos deben tener el mismo conjunto de nombres;
 *  - los nombres sin punto deben llevar el marcador `// legacy` en ambos lados
 *    (snake_case histórico del emisor JS original — NO renombrar, rompe la serie);
 *  - todo call site de `platformLogger.log` / `recordingLogService.log` usa un
 *    nombre de aquí (o el literal idéntico); un evento nuevo = 3 entradas
 *    (aquí, en catalog.rs y una fila en docs/TELEMETRIA.md).
 *
 * Formato: una entrada por línea, clave en MAYÚSCULAS, string en comillas
 * simples, coma y (opcional) el marcador al final — es lo que parsea el lint.
 * No reformatear en multilínea ni poner ejemplos con ese formato en comentarios.
 */
export const TELEMETRY_EVENTS = {
  // ── Ciclo de vida de grabación (emisor: Rust, chokepoint initialize_recording) ──
  RECORDING_STARTED: 'recording_started', // legacy
  RECORDING_START_FAILED: 'recording_start_failed', // legacy
  RECORDING_STOPPED: 'recording_stopped', // legacy

  // ── Jornada: segmento descartado por contenido insuficiente (emisor: Rust,
  //    scheduled_recording/service.rs::finalize_segment_native) ──
  RECORDING_SEGMENT_DISCARDED: 'recording.segment_discarded',

  // ── App / salud (emisor: platformLogger; app.error también Rust vía panics.rs) ──
  APP_OPEN: 'app.open',
  APP_CLOSE: 'app.close',
  APP_ERROR: 'app.error',
  HEALTH_HEARTBEAT: 'health.heartbeat',
  DEVICE_PROFILE: 'device.profile',
  NAV_PAGE_VIEW: 'nav.page_view',
  COACH_SESSION_SUMMARY: 'coach.session_summary',

  // ── Bundle de incidente con consentimiento (emisor: Rust, logging/incident.rs) ──
  INCIDENT_DETECTED: 'incident.detected',
  INCIDENT_BUNDLE_UPLOADED: 'incident.bundle_uploaded',

  // ── Guardado post-grabación (emisor: recordingLogService, outbox recording_logs) ──
  MEETING_ID_GENERATED: 'meeting_id_generated', // legacy
  BUFFER_FLUSH_COMPLETED: 'buffer_flush_completed', // legacy
  SQLITE_SAVE_ATTEMPTED: 'sqlite_save_attempted', // legacy
  SQLITE_SAVE_SUCCEEDED: 'sqlite_save_succeeded', // legacy
  SQLITE_SAVE_FAILED: 'sqlite_save_failed', // legacy
  SAVE_DEFERRED_AUDIO_ONLY: 'save_deferred_audio_only', // legacy
  SAVE_SKIPPED_NO_TRANSCRIPTS: 'save_skipped_no_transcripts', // legacy
  CLOUD_SYNC_ENQUEUED: 'cloud_sync_enqueued', // legacy
  CLOUD_SYNC_ENQUEUE_FAILED: 'cloud_sync_enqueue_failed', // legacy
} as const

/** Nombre de evento catalogado. */
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS]
