/**
 * Recording Log Service
 *
 * Centralized, fire-and-forget logging for the recording lifecycle.
 * Logs are written to local SQLite (recording_logs table) and synced to
 * Supabase (maity.platform_logs) when connectivity is available.
 *
 * Design: never throws — all errors are swallowed to avoid disrupting
 * the recording flow.
 */

import { invoke } from '@tauri-apps/api/core';
import { buildCtx, getTelemetryContext } from '@/lib/telemetryContext';
import type { TelemetryEventName } from '@/lib/telemetry-events';

class RecordingLogService {
  private sessionId: string | null = null;
  private meetingId: string | null = null;
  private appVersion: string | null = null;

  /** Start a new logging session. Call once at recording start. */
  startSession(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    this.sessionId = `session-${ts}-${rand}`;
    this.meetingId = null;
    return this.sessionId;
  }

  /** Get the current session ID */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Associate a meeting_id with the current session */
  setMeetingId(id: string): void {
    this.meetingId = id;
  }

  /**
   * Log a recording lifecycle event.
   * Fire-and-forget — never throws.
   */
  async log(
    eventType: TelemetryEventName,
    eventData?: Record<string, unknown> | null,
    status?: string,
    error?: string,
  ): Promise<void> {
    try {
      if (!this.sessionId) {
        console.warn('[RecordingLog] No session — call startSession() first');
        return;
      }

      // app_version desde el contexto nativo (jamás 'unknown': si no resuelve,
      // viaja null — un NULL honesto es analizable, un centinela no).
      if (!this.appVersion) {
        this.appVersion = (await getTelemetryContext())?.app_version ?? null;
      }

      // Envelope ctx + el id de grabación como campo del payload: ctx.session_id
      // es el de PROCESO (joinea con heartbeats); session-… queda en la columna
      // session_id (serie histórica) y en recording_session_id.
      const ctx = await buildCtx();
      const merged: Record<string, unknown> = { ...(eventData ?? {}) };
      merged.recording_session_id = this.sessionId;
      if (ctx) merged.ctx = ctx;

      await invoke('log_recording_event', {
        sessionId: this.sessionId,
        eventType,
        eventData: JSON.stringify(merged),
        status: status ?? null,
        error: error ?? null,
        meetingId: this.meetingId,
        appVersion: this.appVersion,
        deviceInfo: null,
      });
    } catch (err) {
      // Swallow — logging must never break the app
      console.warn('[RecordingLog] Failed to log event:', eventType, err);
    }
  }

  // syncToCloud() se ELIMINÓ (ciclo fail-closed, G2): el drenaje del outbox lo
  // hace la drenadora nativa (src-tauri/src/logging/telemetry/drain.rs), único
  // writer del RPC insert_platform_log para estas filas. El sync de JS moría
  // con el webview suspendido (tray/jornada) y con la navegación dura post-save,
  // y dos drenadores duplicarían filas.
}

// Singleton
export const recordingLogService = new RecordingLogService();
