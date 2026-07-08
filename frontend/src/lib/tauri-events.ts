/**
 * Constantes de TODOS los eventos Tauri (emit/emitTo/listen/once).
 *
 * ESPEJO EXACTO de `src-tauri/src/events.rs` — el lint pre-build
 * (`scripts/lint-tauri-events.js`) falla si los sets de strings divergen, y
 * también si un call site usa un string literal inline en vez de estas
 * constantes.
 *
 * Los eventos DOM custom (`sync-status-changed`, `finalize-completed`, etc.)
 * NO van aquí: son otro bus (window.dispatchEvent), no eventos Tauri.
 *
 * Convención de nombres: kebab-case del evento → SCREAMING_SNAKE_CASE.
 */
export const TauriEvent = {
  // ── App / lifecycle ───────────────────────────────────────────────────────
  APP_READY: 'app-ready',
  DB_INIT_FAILED: 'db-init-failed',
  DATABASE_INITIALIZED: 'database-initialized',
  FIRST_LAUNCH_DETECTED: 'first-launch-detected',
  DEEP_LINK_RECEIVED: 'deep-link-received',

  // ── Auth (OAuth localhost server) ─────────────────────────────────────────
  AUTH_CODE_RECEIVED: 'auth-code-received',
  AUTH_TOKENS_RECEIVED: 'auth-tokens-received',
  AUTH_SERVER_STOPPED: 'auth-server-stopped',

  // ── Grabación ─────────────────────────────────────────────────────────────
  RECORDING_STARTED: 'recording-started',
  RECORDING_STOPPED: 'recording-stopped',
  RECORDING_PAUSED: 'recording-paused',
  RECORDING_RESUMED: 'recording-resumed',
  RECORDING_ERROR: 'recording-error',
  RECORDING_SAVED: 'recording-saved',
  RECORDING_AUDIO_LEVELS: 'recording-audio-levels',
  RECORDING_SHUTDOWN_PROGRESS: 'recording-shutdown-progress',
  RECORDING_START_COMPLETE: 'recording-start-complete',
  RECORDING_STOP_COMPLETE: 'recording-stop-complete',
  RECORDING_PAUSED_REMINDER: 'recording-paused-reminder',
  TRAY_RECORDING_STARTED: 'tray-recording-started',
  AUDIO_LEVELS: 'audio-levels',
  SPEECH_DETECTED: 'speech-detected',
  MICROPHONE_FALLBACK: 'microphone-fallback',
  MIC_LOOPBACK_WARNING: 'mic-loopback-warning',
  DEVICE_PICKER_SELECTED: 'device-picker-selected',
  SYSTEM_AUDIO_STARTED: 'system-audio-started',
  SYSTEM_AUDIO_STOPPED: 'system-audio-stopped',

  // ── Widget flotante / coach-float (ventanas secundarias) ─────────────────
  WIDGET_REQUEST_START_RECORDING: 'widget-request-start-recording',
  RECORDING_WIDGET_VISIBILITY_CHANGED: 'recording-widget-visibility-changed',
  COACH_FLOAT_VISIBILITY_CHANGED: 'coach-float-visibility-changed',

  // ── Transcripción ─────────────────────────────────────────────────────────
  TRANSCRIPT_UPDATE: 'transcript-update',
  TRANSCRIPTION_ERROR: 'transcription-error',
  TRANSCRIPTION_WARNING: 'transcription-warning',
  TRANSCRIPTION_PROGRESS: 'transcription-progress',
  TRANSCRIPTION_BACKPRESSURE: 'transcription-backpressure',
  TRANSCRIPTION_LAG_WARNING: 'transcription-lag-warning',
  TRANSCRIPTION_LAG_UPDATE: 'transcription-lag-update',
  TRANSCRIPTION_FINISHING: 'transcription-finishing',
  TRANSCRIPTION_QUEUE_COMPLETE: 'transcription-queue-complete',
  TRANSCRIPTION_SUMMARY: 'transcription-summary',
  TRANSCRIPTION_COMPLETE: 'transcription-complete',
  TRANSCRIPTION_PRELOAD_COMPLETED: 'transcription-preload-completed',
  TRANSCRIPT_CHUNK_LOSS_DETECTED: 'transcript-chunk-loss-detected',

  // ── Coach (live feedback + evaluación + setup) ────────────────────────────
  COACH_TIP_UPDATE: 'coach-tip-update',
  COACH_METRICS: 'coach-metrics',
  COACH_ENGINE_READY: 'coach-engine-ready',
  COACH_EVAL_COMPLETE: 'coach-eval-complete',
  COACH_EVAL_ERROR: 'coach-eval-error',
  COACH_SETUP_PROGRESS: 'coach-setup-progress',
  COACH_GGUF_DOWNLOAD_PROGRESS: 'coach-gguf-download-progress',
  COACH_GGUF_DOWNLOAD_COMPLETE: 'coach-gguf-download-complete',
  COACH_GGUF_DOWNLOAD_ERROR: 'coach-gguf-download-error',
  MEETING_METRICS: 'meeting-metrics',

  // ── Meeting detector ──────────────────────────────────────────────────────
  MEETING_DETECTED: 'meeting-detected',
  START_RECORDING_FROM_DETECTOR: 'start-recording-from-detector',

  // ── Grabación programada (scheduler) ──────────────────────────────────────
  SCHEDULED_RECORDING_STATUS: 'scheduled-recording-status',
  SCHEDULED_RECORDING_SKIPPED: 'scheduled-recording-skipped',
  // Rotación por hora (Incremento 4): resetear buffer + encolar sync SIN navegar.
  SCHEDULED_SEGMENT_ROTATED: 'scheduled-segment-rotated',

  // ── Modelos: Whisper (nombres genéricos legacy) + config ─────────────────
  MODEL_LOADING_STARTED: 'model-loading-started',
  MODEL_LOADING_COMPLETED: 'model-loading-completed',
  MODEL_LOADING_FAILED: 'model-loading-failed',
  MODEL_DOWNLOAD_PROGRESS: 'model-download-progress',
  MODEL_DOWNLOAD_COMPLETE: 'model-download-complete',
  MODEL_DOWNLOAD_ERROR: 'model-download-error',
  MODEL_CONFIG_UPDATED: 'model-config-updated',

  // ── Modelos: Parakeet ─────────────────────────────────────────────────────
  PARAKEET_MODEL_LOADING_STARTED: 'parakeet-model-loading-started',
  PARAKEET_MODEL_LOADING_COMPLETED: 'parakeet-model-loading-completed',
  PARAKEET_MODEL_LOADING_FAILED: 'parakeet-model-loading-failed',
  PARAKEET_MODEL_DOWNLOAD_PROGRESS: 'parakeet-model-download-progress',
  PARAKEET_MODEL_DOWNLOAD_COMPLETE: 'parakeet-model-download-complete',
  PARAKEET_MODEL_DOWNLOAD_ERROR: 'parakeet-model-download-error',

  // ── Modelos: Moonshine ────────────────────────────────────────────────────
  MOONSHINE_MODEL_LOADING_STARTED: 'moonshine-model-loading-started',
  MOONSHINE_MODEL_LOADING_COMPLETED: 'moonshine-model-loading-completed',
  MOONSHINE_MODEL_LOADING_FAILED: 'moonshine-model-loading-failed',
  MOONSHINE_MODEL_DOWNLOAD_PROGRESS: 'moonshine-model-download-progress',
  MOONSHINE_MODEL_DOWNLOAD_COMPLETE: 'moonshine-model-download-complete',
  MOONSHINE_MODEL_DOWNLOAD_ERROR: 'moonshine-model-download-error',

  // ── Modelos: Canary ───────────────────────────────────────────────────────
  CANARY_MODEL_LOADING_STARTED: 'canary-model-loading-started',
  CANARY_MODEL_LOADING_COMPLETED: 'canary-model-loading-completed',
  CANARY_MODEL_LOADING_FAILED: 'canary-model-loading-failed',
  CANARY_MODEL_DOWNLOAD_PROGRESS: 'canary-model-download-progress',
  CANARY_MODEL_DOWNLOAD_COMPLETE: 'canary-model-download-complete',
  CANARY_MODEL_DOWNLOAD_ERROR: 'canary-model-download-error',

  // ── Modelos: Ollama ───────────────────────────────────────────────────────
  OLLAMA_MODEL_DOWNLOAD_PROGRESS: 'ollama-model-download-progress',
  OLLAMA_MODEL_DOWNLOAD_COMPLETE: 'ollama-model-download-complete',
  OLLAMA_MODEL_DOWNLOAD_ERROR: 'ollama-model-download-error',

  // ── Modelos: Built-in AI (summary engine sidecar) ─────────────────────────
  BUILTIN_AI_DOWNLOAD_PROGRESS: 'builtin-ai-download-progress',
} as const

/** Nombre de evento Tauri válido (uno de los valores de TauriEvent). */
export type TauriEventName = (typeof TauriEvent)[keyof typeof TauriEvent]
