/**
 * Stub no-op de Analytics — la integracion original con PostHog se removio
 * porque la API key estaba hardcoded apuntando al workspace upstream del fork
 * (Maity). Este stub mantiene la firma publica para no tocar los ~100
 * call-sites del codigo, todos quedan no-op.
 *
 * Lo unico que se preserva es el dual-emit a `platformLogger` (Supabase
 * `maity.platform_logs`) para que el logging cross-app siga funcionando — eso
 * NO es PostHog y va al Supabase del usuario.
 *
 * En un PR posterior se pueden remover los call-sites incrementalmente y
 * borrar este archivo por completo.
 */
import { platformLogger } from '@/lib/platformLogger';

export interface AnalyticsProperties {
  [key: string]: string;
}

export interface UserSession {
  session_id: string;
  user_id: string;
  start_time: string;
  last_heartbeat: string;
  is_active: boolean;
}

export class Analytics {
  private static currentUserId: string | null = null;

  static async init(): Promise<void> { /* no-op */ }
  static async disable(): Promise<void> { /* no-op */ }
  static async isEnabled(): Promise<boolean> { return false; }

  /**
   * Mantiene el dual-emit a Supabase platform_logs (no es PostHog).
   * Analítica de producto (UI): FUERA del catálogo de telemetría a propósito —
   * `docs/TELEMETRIA.md` la documenta como una sola fila de passthrough.
   */
  static async track(eventName: string, properties?: AnalyticsProperties): Promise<void> {
    void platformLogger.log(eventName, properties); // telemetry-allow: passthrough legacy de Analytics.track (analitica de producto, fuera del catalogo)
  }

  static async identify(userId: string, _properties?: AnalyticsProperties): Promise<void> {
    this.currentUserId = userId;
  }

  static async startSession(userId: string): Promise<string | null> {
    this.currentUserId = userId;
    return null;
  }
  static async endSession(): Promise<void> { /* no-op */ }
  static async trackDailyActiveUser(): Promise<void> { /* no-op */ }
  static async trackUserFirstLaunch(): Promise<void> { /* no-op */ }
  static async isSessionActive(): Promise<boolean> { return false; }

  static async getPersistentUserId(): Promise<string> {
    // Fallback determinista para callers legacy. La identidad real del usuario
    // viene de AuthContext.maityUser.id, no de aqui.
    let userId = sessionStorage.getItem('maity_user_id');
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem('maity_user_id', userId);
    }
    return userId;
  }

  static async checkAndTrackFirstLaunch(): Promise<void> { /* no-op */ }
  static async checkAndTrackDailyUsage(): Promise<void> { /* no-op */ }

  static getCurrentUserId(): string | null { return this.currentUserId; }

  static async getPlatform(): Promise<string> {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('win')) return 'windows';
    if (ua.includes('linux')) return 'linux';
    return 'unknown';
  }
  // getOSVersion/getDeviceInfo eliminados (ago-2026): devolvían 'unknown' en
  // campos de versión y no tenían consumidores. La versión de OS real viaja en
  // `device.profile` (Rust, `get_device_profile`), nunca como centinela.

  static async calculateDaysSince(_dateKey: string): Promise<number | null> { return null; }
  static async updateMeetingCount(): Promise<void> { /* no-op */ }
  static async getMeetingsCountToday(): Promise<number> { return 0; }
  static async hasUsedFeatureBefore(_featureName: string): Promise<boolean> { return false; }
  static async markFeatureUsed(_featureName: string): Promise<void> { /* no-op */ }

  static async trackSessionStarted(_sessionId: string): Promise<void> { /* no-op */ }
  static async trackSessionEnded(_sessionId: string): Promise<void> { /* no-op */ }
  static async trackMeetingCompleted(
    _meetingId: string,
    _metrics: Record<string, unknown>,
  ): Promise<void> { /* no-op */ }
  static async trackFeatureUsedEnhanced(
    _featureName: string,
    _properties?: Record<string, unknown>,
  ): Promise<void> { /* no-op */ }
  static async trackCopy(
    _copyType: 'transcript' | 'summary',
    _properties?: Record<string, unknown>,
  ): Promise<void> { /* no-op */ }

  static async trackMeetingStarted(_meetingId: string, _meetingTitle: string): Promise<void> { /* no-op */ }
  static async trackRecordingStarted(_meetingId: string): Promise<void> { /* no-op */ }
  static async trackRecordingStopped(_meetingId: string, _durationSeconds?: number): Promise<void> { /* no-op */ }
  static async trackMeetingDeleted(_meetingId: string): Promise<void> { /* no-op */ }
  static async trackSettingsChanged(_settingType: string, _newValue: string): Promise<void> { /* no-op */ }
  static async trackFeatureUsed(_featureName: string): Promise<void> { /* no-op */ }
  static async trackPageView(pageName: string): Promise<void> {
    void platformLogger.log('nav.page_view', { path: pageName });
  }
  static async trackButtonClick(_buttonName: string, _location?: string): Promise<void> { /* no-op */ }
  static async trackError(_errorType: string, _errorMessage: string): Promise<void> { /* no-op */ }
  static async trackAppStarted(): Promise<void> { /* no-op */ }
  static async cleanup(): Promise<void> { /* no-op */ }
  static reset(): void { this.currentUserId = null; }
  static async waitForInitialization(_timeout: number = 5000): Promise<boolean> { return true; }

  static async trackBackendConnection(_success: boolean, _error?: string): Promise<void> { /* no-op */ }
  static async trackTranscriptionError(_errorMessage: string): Promise<void> { /* no-op */ }
  static async trackTranscriptionSuccess(_duration?: number): Promise<void> { /* no-op */ }
  static async trackSummaryGenerationStarted(
    ..._args: unknown[]
  ): Promise<void> { /* no-op */ }
  static async trackSummaryGenerationCompleted(
    ..._args: unknown[]
  ): Promise<void> { /* no-op */ }
  static async trackSummaryRegenerated(_modelProvider: string, _modelName: string): Promise<void> { /* no-op */ }
  static async trackModelChanged(
    _oldProvider: string,
    _oldModel: string,
    _newProvider: string,
    _newModel: string,
  ): Promise<void> { /* no-op */ }
  static async trackCustomPromptUsed(_promptLength: number): Promise<void> { /* no-op */ }
  static async trackAnalyticsEnabled(): Promise<void> { /* no-op */ }
  static async trackAnalyticsDisabled(): Promise<void> { /* no-op */ }
  static async trackAnalyticsTransparencyViewed(): Promise<void> { /* no-op */ }
}

export default Analytics;
