/**
 * PlatformLogger — fire-and-forget client-side event logger for desktop.
 *
 * Sends structured events to `maity.platform_logs` via the
 * `insert_platform_log` RPC. Never throws; every call is async
 * and failures are silently swallowed so logging can never
 * crash the host application.
 *
 * Mirrors the web app's `src/lib/platformLogger.ts` so both
 * platforms emit to the same canonical table for cross-app analytics.
 */

import { supabase } from '@/lib/supabase'

export type PlatformLogStatus = 'success' | 'error' | 'timeout' | 'skipped'

/** Known event types — extensible via `string` union */
export type PlatformEventType =
  | 'app.open'
  | 'app.close'
  | 'nav.page_view'
  | 'app.start'
  | 'app.error'
  | 'meeting.start'
  | 'meeting.end'
  | 'meeting.save'
  | 'recording.start'
  | 'recording.stop'
  | 'recording.save'
  | 'recording.error'
  | 'sync.start'
  | 'sync.complete'
  | 'sync.error'
  | (string & {})

class PlatformLogger {
  private static instance: PlatformLogger
  private sessionId: string

  private constructor() {
    this.sessionId = this.generateSessionId()
  }

  static getInstance(): PlatformLogger {
    if (!PlatformLogger.instance) {
      PlatformLogger.instance = new PlatformLogger()
    }
    return PlatformLogger.instance
  }

  startSession(): string {
    this.sessionId = this.generateSessionId()
    return this.sessionId
  }

  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Log a platform event. Fire-and-forget — never throws.
   */
  async log(
    eventType: PlatformEventType,
    data?: Record<string, unknown>,
    status?: PlatformLogStatus,
    error?: string,
  ): Promise<void> {
    try {
      const userAgent =
        typeof navigator !== 'undefined' ? navigator.userAgent : null
      await supabase.rpc('insert_platform_log', {
        p_session_id: this.sessionId,
        p_platform: 'desktop',
        p_event_type: eventType,
        p_event_data: data ?? null,
        p_status: status ?? null,
        p_error: error ?? null,
        p_meeting_id: null,
        p_app_version: null,
        p_device_info: userAgent,
      })
    } catch {
      // Silently swallow — telemetry must never disrupt the app.
    }
  }

  private generateSessionId(): string {
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 10)
    return `desktop-${ts}-${rand}`
  }
}

export const platformLogger = PlatformLogger.getInstance()
