export enum RecordingStatus {
  IDLE = 'idle',                          // Not recording
  STARTING = 'starting',                  // Initiating recording
  RECORDING = 'recording',                // Active recording
  STOPPING = 'stopping',                  // Stop initiated, waiting for backend
  PROCESSING_TRANSCRIPTS = 'processing',  // Transcription completion wait
  SAVING = 'saving',                      // Saving to database
  COMPLETED = 'completed',                // Successfully saved
  ERROR = 'error'                         // Error occurred
}

/**
 * Fase de la máquina de estados del backend (recording_phase.rs) — la fuente
 * de verdad global en Rust. Llega como campo aditivo `phase` en el payload de
 * `get_recording_state`. No confundir con RecordingStatus: ese incluye estados
 * UI-only del frontend (processing/saving/completed) que Rust no conoce.
 */
export type BackendRecordingPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping';

export interface RecordingState {
  isRecording: boolean;           // Is a recording session active
  isPaused: boolean;              // Is the recording paused
  isActive: boolean;              // Is actively recording (recording && !paused)
  recordingDuration: number | null;  // Total duration including pauses
  activeDuration: number | null;     // Active recording time (excluding pauses)

  // Fase exacta reportada por el backend (opcional: builds viejos no la mandan)
  backendPhase?: BackendRecordingPhase;

  // Lifecycle status
  status: RecordingStatus;
  statusMessage?: string;  // Optional message for current status
}
