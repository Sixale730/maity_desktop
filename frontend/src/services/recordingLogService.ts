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
import { logger } from '@/lib/logger';
import { getVersion } from '@tauri-apps/api/app';
import { supabase } from '@/lib/supabase';

interface RecordingLog {
  id: number;
  session_id: string;
  event_type: string;
  event_data: string | null;
  status: string | null;
  error: string | null;
  meeting_id: string | null;
  app_version: string | null;
  device_info: string | null;
  synced_to_cloud: boolean;
  created_at: string;
}

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
    eventType: string,
    eventData?: Record<string, unknown> | null,
    status?: string,
    error?: string,
  ): Promise<void> {
    try {
      if (!this.sessionId) {
        console.warn('[RecordingLog] No session — call startSession() first');
        return;
      }

      if (!this.appVersion) {
        try {
          this.appVersion = await getVersion();
        } catch {
          this.appVersion = 'unknown';
        }
      }

      await invoke('log_recording_event', {
        sessionId: this.sessionId,
        eventType,
        eventData: eventData ? JSON.stringify(eventData) : null,
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

  /**
   * Sync unsynced logs to Supabase (maity.platform_logs).
   * Call after the recording stop flow completes.
   *
   * Uses the canonical RPC `insert_platform_log` (SECURITY DEFINER server-side
   * resolves user_id from auth.uid() → maity.users.id, bypassing RLS in a
   * controlled way). Same pattern as platformLogger.ts and the web app's logger.
   * Direct INSERTs are NOT allowed by RLS because user_id must equal
   * maity.users.id (the internal FK), not auth.users.id.
   */
  async syncToCloud(): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        // Not authenticated — skip sync silently
        return;
      }

      const unsynced: RecordingLog[] = await invoke('get_unsynced_recording_logs', { limit: 200 });
      if (unsynced.length === 0) return;

      const results = await Promise.allSettled(
        unsynced.map((log) =>
          supabase.rpc('insert_platform_log', {
            p_session_id: log.session_id,
            p_platform: 'desktop',
            p_event_type: log.event_type,
            p_event_data: log.event_data ? JSON.parse(log.event_data) : null,
            p_status: log.status,
            p_error: log.error,
            p_meeting_id: log.meeting_id,
            p_app_version: log.app_version,
            p_device_info: log.device_info,
          }),
        ),
      );

      const succeededIds = unsynced
        .filter((_, i) => {
          const r = results[i];
          return r.status === 'fulfilled' && !r.value.error;
        })
        .map((l) => l.id);

      if (succeededIds.length > 0) {
        await invoke('mark_recording_logs_synced', { ids: succeededIds });
        logger.debug(`[RecordingLog] Synced ${succeededIds.length}/${unsynced.length} logs to cloud`);
      }

      const failedCount = unsynced.length - succeededIds.length;
      if (failedCount > 0) {
        console.warn(`[RecordingLog] ${failedCount} logs failed to sync; will retry on next sync`);
      }
    } catch (err) {
      console.warn('[RecordingLog] syncToCloud failed:', err);
    }
  }
}

// Singleton
export const recordingLogService = new RecordingLogService();
