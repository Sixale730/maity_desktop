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

      // Map to Supabase table shape
      const rows = unsynced.map((log) => ({
        user_id: session.user.id,
        platform: 'desktop' as const,
        session_id: log.session_id,
        event_type: log.event_type,
        event_data: log.event_data ? JSON.parse(log.event_data) : null,
        status: log.status,
        error: log.error,
        meeting_id: log.meeting_id,
        app_version: log.app_version,
        device_info: log.device_info,
        created_at: log.created_at,
      }));

      const { error } = await supabase
        .from('platform_logs')
        .insert(rows);

      if (error) {
        console.warn('[RecordingLog] Supabase sync error:', error.message);
        return;
      }

      // Mark as synced
      const ids = unsynced.map((l) => l.id);
      await invoke('mark_recording_logs_synced', { ids });
      logger.debug(`[RecordingLog] Synced ${ids.length} logs to cloud`);
    } catch (err) {
      console.warn('[RecordingLog] syncToCloud failed:', err);
    }
  }
}

// Singleton
export const recordingLogService = new RecordingLogService();
