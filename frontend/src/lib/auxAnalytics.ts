/**
 * Analítica de producto para las ventanas AUXILIARES (coach-float,
 * recording-widget, device-picker) — gemelo nativo de `Analytics.track`.
 *
 * Por qué no `lib/analytics.ts`: su `track` pasa por `platformLogger`, que
 * importa supabase-js (~200 KB de chunk + un cliente GoTrue con
 * autoRefreshToken en CADA webview que lo toca). En el coach-float eso se
 * instanciaba con el primer tip de cada grabación (#23 de la auditoría de
 * recursos, sep-2026). Aquí el evento viaja por `invoke` al comando
 * `log_analytics_event` (logging/telemetry/emit.rs), que lo escribe al outbox
 * `recording_logs` con `ctx.emitter='webview'` y `ctx.window=<label real>`;
 * `drain.rs` lo sube a `maity.platform_logs` (single writer). Consecuencias:
 * cero red en el webview, sobrevive a la ventana cerrada, y la COLUMNA
 * `session_id` es la de proceso (`proc-…`), no una `desktop-…` por webview.
 *
 * Sigue FUERA del catálogo de telemetría, igual que `Analytics.track`
 * (analítica de producto: `coach_float.*`); ver docs/TELEMETRIA.md.
 * El fitness test app/(aux)/layout.test.ts prohíbe que el grafo aux alcance
 * platformLogger/supabase: si una ventana aux necesita telemetría, es por aquí.
 */
import { invoke } from '@tauri-apps/api/core';

export type AuxAnalyticsProperties = Record<string, string>;

/** Fire-and-forget: jamás rechaza, la telemetría no rompe la ventana. */
export async function trackAux(eventName: string, properties?: AuxAnalyticsProperties): Promise<void> {
  try {
    await invoke('log_analytics_event', { eventType: eventName, eventData: properties ?? {} }); // telemetry-allow: passthrough de analítica de producto (gemelo nativo de Analytics.track para ventanas aux)
  } catch {
    // Fuera de Tauri (dev en browser) o comando ausente: silencio.
  }
}
