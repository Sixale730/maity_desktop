// events.rs
//
// Constantes de TODOS los eventos Tauri del proceso (emit/emit_to/listen).
// Fuente de verdad única: el espejo TS vive en `src/lib/tauri-events.ts` y
// AMBOS archivos deben contener exactamente el mismo set de strings — el lint
// pre-build (`scripts/lint-tauri-events.js`) falla si divergen, y también si
// un call site usa un string literal inline en vez de estas constantes.
//
// Motivación (jul-2026): 90 eventos duplicados a mano entre Rust y TS
// produjeron 4 listeners huérfanos (incluido el typo `transcript-error` vs
// `transcription-error`) y una constante definida dos veces.
//
// Convención de nombres: kebab-case del evento → SCREAMING_SNAKE_CASE.

// ── App / lifecycle ─────────────────────────────────────────────────────────
pub const APP_READY: &str = "app-ready";
pub const DB_INIT_FAILED: &str = "db-init-failed";
pub const DATABASE_INITIALIZED: &str = "database-initialized";
pub const FIRST_LAUNCH_DETECTED: &str = "first-launch-detected";
pub const DEEP_LINK_RECEIVED: &str = "deep-link-received";
pub const RUST_ERROR: &str = "rust-error";

// ── Auth (OAuth localhost server) ───────────────────────────────────────────
pub const AUTH_CODE_RECEIVED: &str = "auth-code-received";
pub const AUTH_TOKENS_RECEIVED: &str = "auth-tokens-received";
pub const AUTH_SERVER_STOPPED: &str = "auth-server-stopped";

// ── Grabación ───────────────────────────────────────────────────────────────
pub const RECORDING_STARTED: &str = "recording-started";
pub const RECORDING_STOPPED: &str = "recording-stopped";
pub const RECORDING_PAUSED: &str = "recording-paused";
pub const RECORDING_RESUMED: &str = "recording-resumed";
pub const RECORDING_ERROR: &str = "recording-error";
pub const RECORDING_SAVED: &str = "recording-saved";
pub const RECORDING_AUDIO_LEVELS: &str = "recording-audio-levels";
pub const RECORDING_SHUTDOWN_PROGRESS: &str = "recording-shutdown-progress";
pub const RECORDING_START_COMPLETE: &str = "recording-start-complete";
pub const RECORDING_STOP_COMPLETE: &str = "recording-stop-complete";
pub const RECORDING_PAUSED_REMINDER: &str = "recording-paused-reminder";
pub const TRAY_RECORDING_STARTED: &str = "tray-recording-started";
pub const AUDIO_LEVELS: &str = "audio-levels";
pub const SPEECH_DETECTED: &str = "speech-detected";
pub const MICROPHONE_FALLBACK: &str = "microphone-fallback";
pub const MIC_LOOPBACK_WARNING: &str = "mic-loopback-warning";
/// Watchdog: el mic lleva N s sin audio durante grabación activa. Payload:
/// `{ device: string|null, silenceSecs: number, mode: "silent"|"stalled" }`.
/// Latch: una alerta por episodio; se rearma cuando vuelve audio audible.
pub const MIC_SILENCE_WARNING: &str = "mic-silence-warning";
pub const DEVICE_PICKER_SELECTED: &str = "device-picker-selected";
pub const SYSTEM_AUDIO_STARTED: &str = "system-audio-started";
pub const SYSTEM_AUDIO_STOPPED: &str = "system-audio-stopped";

// ── Widget flotante / coach-float (ventanas secundarias) ───────────────────
pub const WIDGET_REQUEST_START_RECORDING: &str = "widget-request-start-recording";
pub const RECORDING_WIDGET_VISIBILITY_CHANGED: &str = "recording-widget-visibility-changed";
pub const COACH_FLOAT_VISIBILITY_CHANGED: &str = "coach-float-visibility-changed";

// ── Transcripción ───────────────────────────────────────────────────────────
pub const TRANSCRIPT_UPDATE: &str = "transcript-update";
pub const TRANSCRIPTION_ERROR: &str = "transcription-error";
pub const TRANSCRIPTION_WARNING: &str = "transcription-warning";
pub const TRANSCRIPTION_PROGRESS: &str = "transcription-progress";
pub const TRANSCRIPTION_BACKPRESSURE: &str = "transcription-backpressure";
pub const TRANSCRIPTION_LAG_WARNING: &str = "transcription-lag-warning";
pub const TRANSCRIPTION_LAG_UPDATE: &str = "transcription-lag-update";
pub const TRANSCRIPTION_FINISHING: &str = "transcription-finishing";
pub const TRANSCRIPTION_QUEUE_COMPLETE: &str = "transcription-queue-complete";
pub const TRANSCRIPTION_SUMMARY: &str = "transcription-summary";
pub const TRANSCRIPTION_COMPLETE: &str = "transcription-complete";
pub const TRANSCRIPTION_PRELOAD_COMPLETED: &str = "transcription-preload-completed";
pub const TRANSCRIPT_CHUNK_LOSS_DETECTED: &str = "transcript-chunk-loss-detected";

// ── Coach (live feedback + evaluación + setup) ─────────────────────────────
pub const COACH_TIP_UPDATE: &str = "coach-tip-update";
pub const COACH_METRICS: &str = "coach-metrics";
pub const COACH_ENGINE_READY: &str = "coach-engine-ready";
pub const COACH_EVAL_COMPLETE: &str = "coach-eval-complete";
pub const COACH_EVAL_ERROR: &str = "coach-eval-error";
pub const COACH_SETUP_PROGRESS: &str = "coach-setup-progress";
pub const COACH_GGUF_DOWNLOAD_PROGRESS: &str = "coach-gguf-download-progress";
pub const COACH_GGUF_DOWNLOAD_COMPLETE: &str = "coach-gguf-download-complete";
pub const COACH_GGUF_DOWNLOAD_ERROR: &str = "coach-gguf-download-error";
pub const MEETING_METRICS: &str = "meeting-metrics";

// ── Meeting detector ────────────────────────────────────────────────────────
pub const MEETING_DETECTED: &str = "meeting-detected";
pub const START_RECORDING_FROM_DETECTOR: &str = "start-recording-from-detector";

// ── Grabación programada (scheduler) ────────────────────────────────────────
pub const SCHEDULED_RECORDING_STATUS: &str = "scheduled-recording-status";
pub const SCHEDULED_RECORDING_SKIPPED: &str = "scheduled-recording-skipped";
/// Emitido tras rotar el segmento por hora (Incremento 4). El frontend lo usa para
/// resetear su buffer de transcripción y encolar la sync del segmento cerrado, SIN
/// navegar (a diferencia de `recording-stop-complete`). Payload: `{ meetingId, meetingName }`.
pub const SCHEDULED_SEGMENT_ROTATED: &str = "scheduled-segment-rotated";
/// Emitido tras el cierre por hora fija headless-safe (gap #54): Rust ya guardó el último
/// segmento (local + outbox cloud). El frontend SOLO limpia su buffer, sin navegar. Se
/// emite XOR con `recording-stop-complete` (fallback cuando el finalize headless no
/// persistió nada). Payload: `{ meetingId, meetingName }`.
pub const SCHEDULED_JORNADA_CLOSED: &str = "scheduled-jornada-closed";

// ── Modelos: Whisper (nombres genéricos legacy) + config ────────────────────
pub const MODEL_LOADING_STARTED: &str = "model-loading-started";
pub const MODEL_LOADING_COMPLETED: &str = "model-loading-completed";
pub const MODEL_LOADING_FAILED: &str = "model-loading-failed";
pub const MODEL_DOWNLOAD_PROGRESS: &str = "model-download-progress";
pub const MODEL_DOWNLOAD_COMPLETE: &str = "model-download-complete";
pub const MODEL_DOWNLOAD_ERROR: &str = "model-download-error";
pub const MODEL_CONFIG_UPDATED: &str = "model-config-updated";

// ── Modelos: Parakeet ───────────────────────────────────────────────────────
pub const PARAKEET_MODEL_LOADING_STARTED: &str = "parakeet-model-loading-started";
pub const PARAKEET_MODEL_LOADING_COMPLETED: &str = "parakeet-model-loading-completed";
pub const PARAKEET_MODEL_LOADING_FAILED: &str = "parakeet-model-loading-failed";
pub const PARAKEET_MODEL_DOWNLOAD_PROGRESS: &str = "parakeet-model-download-progress";
pub const PARAKEET_MODEL_DOWNLOAD_COMPLETE: &str = "parakeet-model-download-complete";
pub const PARAKEET_MODEL_DOWNLOAD_ERROR: &str = "parakeet-model-download-error";

// ── Modelos: Moonshine ──────────────────────────────────────────────────────
pub const MOONSHINE_MODEL_LOADING_STARTED: &str = "moonshine-model-loading-started";
pub const MOONSHINE_MODEL_LOADING_COMPLETED: &str = "moonshine-model-loading-completed";
pub const MOONSHINE_MODEL_LOADING_FAILED: &str = "moonshine-model-loading-failed";
pub const MOONSHINE_MODEL_DOWNLOAD_PROGRESS: &str = "moonshine-model-download-progress";
pub const MOONSHINE_MODEL_DOWNLOAD_COMPLETE: &str = "moonshine-model-download-complete";
pub const MOONSHINE_MODEL_DOWNLOAD_ERROR: &str = "moonshine-model-download-error";

// ── Modelos: Canary ─────────────────────────────────────────────────────────
pub const CANARY_MODEL_LOADING_STARTED: &str = "canary-model-loading-started";
pub const CANARY_MODEL_LOADING_COMPLETED: &str = "canary-model-loading-completed";
pub const CANARY_MODEL_LOADING_FAILED: &str = "canary-model-loading-failed";
pub const CANARY_MODEL_DOWNLOAD_PROGRESS: &str = "canary-model-download-progress";
pub const CANARY_MODEL_DOWNLOAD_COMPLETE: &str = "canary-model-download-complete";
pub const CANARY_MODEL_DOWNLOAD_ERROR: &str = "canary-model-download-error";

// ── Modelos: Ollama ─────────────────────────────────────────────────────────
pub const OLLAMA_MODEL_DOWNLOAD_PROGRESS: &str = "ollama-model-download-progress";
pub const OLLAMA_MODEL_DOWNLOAD_COMPLETE: &str = "ollama-model-download-complete";
pub const OLLAMA_MODEL_DOWNLOAD_ERROR: &str = "ollama-model-download-error";

// ── Modelos: Built-in AI (summary engine sidecar) ───────────────────────────
pub const BUILTIN_AI_DOWNLOAD_PROGRESS: &str = "builtin-ai-download-progress";
