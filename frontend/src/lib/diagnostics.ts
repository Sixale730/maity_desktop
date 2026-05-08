/**
 * Instrumentacion del polling de analisis para repro local y produccion.
 *
 * Todos los eventos relevantes emiten un log con prefijo `[POLL]` que va
 * tanto a DevTools console (filtrable en vivo) como al archivo rotativo
 * de Maity (`maity.YYYY-MM-DD.log`, recuperable via Settings -> Logging
 * -> Export). Sirve para diagnosticar el bug intermitente "polling se
 * queda cargando, cerrar+abrir lo arregla".
 *
 * Tambien expone helpers en `window.__pollDebug` para inspeccion manual
 * desde la consola cuando se reproduce el bug.
 */
import { fileLogger } from './fileLogger';

/**
 * Log estructurado de un evento del polling. Dual-emit:
 * - DevTools console: `console.log` directo (no pasa por logger.ts que esta
 *   guarded por isDev — production builds silenciarian logger.info y los POLL
 *   no aparecerian en consola incluso con DevTools abierto).
 * - Archivo rotativo: via fileLogger.info → invoke('log_frontend_event') al
 *   handler Rust que escribe a maity.YYYY-MM-DD.log.
 *
 * Es importante NO depender solo de fileLogger.info para consola: en debug
 * builds y releases firmados, NODE_ENV=production y logger.info de lib/logger
 * silencia console.info. El console.log directo aqui garantiza visibility en
 * cualquier modo.
 */
export function logPoll(event: string, data: Record<string, unknown> = {}): void {
  const entry = { event, ts: new Date().toISOString(), ...data };
  // eslint-disable-next-line no-console
  console.log('[POLL]', entry);
  fileLogger.info('POLL', event, entry);
}

declare global {
  interface Window {
    __pollDebug?: {
      fetchConversation: (id: string) => Promise<unknown>;
      sessionState: () => Promise<unknown>;
      realtimeState: () => Promise<unknown>;
    };
  }
}

/**
 * Helpers expuestos en runtime para diagnosticar el bug cuando se observa.
 * Idempotente: solo se instala una vez por carga de la app.
 */
export function installPollDebugHelpers(): void {
  if (typeof window === 'undefined') return;
  if (window.__pollDebug) return;

  window.__pollDebug = {
    /** Lee el row actual de Supabase para una conversacion (bypassa cache). */
    fetchConversation: async (id: string) => {
      const { supabase } = await import('./supabase');
      const t0 = performance.now();
      const { data, error } = await supabase
        .from('omi_conversations')
        .select('*')
        .eq('id', id)
        .single();
      const elapsedMs = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log('[POLL_DEBUG] fetchConversation', { id, elapsedMs, data, error });
      return { data, error, elapsedMs };
    },

    /** Estado actual de la sesion Supabase (revisa expires_at para detectar JWT expirado). */
    sessionState: async () => {
      const { supabase } = await import('./supabase');
      const { data, error } = await supabase.auth.getSession();
      const expiresAt = data?.session?.expires_at ?? null;
      const isExpired = expiresAt ? expiresAt * 1000 < Date.now() : null;
      // eslint-disable-next-line no-console
      console.log('[POLL_DEBUG] sessionState', {
        hasSession: !!data?.session,
        userId: data?.session?.user?.id ?? null,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        isExpired,
        error,
      });
      return data;
    },

    /** Estado del WebSocket de Realtime de Supabase. */
    realtimeState: async () => {
      const { supabase } = await import('./supabase');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rt = supabase.realtime as any;
      const state = {
        isConnected: typeof rt.isConnected === 'function' ? rt.isConnected() : null,
        connState: rt.connState ?? null,
        channels: typeof rt.getChannels === 'function'
          ? rt.getChannels().map((c: { topic: string; state: string }) => ({
              topic: c.topic,
              state: c.state,
            }))
          : null,
      };
      // eslint-disable-next-line no-console
      console.log('[POLL_DEBUG] realtimeState', state);
      return state;
    },
  };
}

// Auto-instalar helpers al cargar el modulo (browser only).
if (typeof window !== 'undefined') {
  installPollDebugHelpers();
}
