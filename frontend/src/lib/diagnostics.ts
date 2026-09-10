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

/** Latido del muestreo: aunque nada cambie, cada clave emite al menos una
 *  línea por minuto para que el log siga probando que el poll está vivo. */
export const POLL_LOG_HEARTBEAT_MS = 60_000;
/** Tope de claves vivas en el dedupe (una por evento × conversación abierta). */
const POLL_LOG_MAX_KEYS = 256;

interface PollLogEntry {
  sig: string;
  at: number;
  suppressed: number;
}

const pollLogState = new Map<string, PollLogEntry>();

/**
 * `logPoll` muestreado para call sites CALIENTES (#25 de la auditoría de
 * recursos): el poll de 3 s del detalle y los UPDATE de Realtime emitían
 * ~60-80 IPC + líneas de log por minuto con un detalle abierto, casi todas
 * idénticas (TanStack evalúa la función `refetchInterval` en cada render y
 * en cada cambio de estado de la query). Emite sólo si `signature` cambió
 * respecto a la última emisión de `key`, o si pasó `POLL_LOG_HEARTBEAT_MS`
 * desde ella (latido). El latido lleva `heartbeat: true` y `suppressed: n`
 * — cuántas llamadas se callaron desde la emisión anterior — al estilo del
 * limiter de `emit_start_failed` en Rust.
 *
 * La `signature` la elige el caller a propósito: campos que cambian en cada
 * tick sin decir nada nuevo (`fetch_status`, el `updated_at` del heartbeat de
 * la nube) pueden seguir viajando en `data` sin reventar el dedupe.
 *
 * Diagnosticabilidad: un poll atorado se ve como latidos de
 * `refetchInterval_eval` sin ningún `queryFn_success` entre medio; cualquier
 * cambio de estado sale al instante, como antes.
 */
export function logPollIfChanged(
  key: string,
  event: string,
  data: Record<string, unknown>,
  signature: unknown[],
): void {
  const now = Date.now();
  const sig = JSON.stringify(signature);
  const prev = pollLogState.get(key);

  if (prev !== undefined && prev.sig === sig && now - prev.at < POLL_LOG_HEARTBEAT_MS) {
    prev.suppressed += 1;
    return;
  }

  const isHeartbeat = prev !== undefined && prev.sig === sig;
  const suppressed = prev?.suppressed ?? 0;

  // Re-insertar mueve la clave al final del Map: el tope descarta la más vieja.
  pollLogState.delete(key);
  if (pollLogState.size >= POLL_LOG_MAX_KEYS) {
    const oldest = pollLogState.keys().next().value;
    if (oldest !== undefined) pollLogState.delete(oldest);
  }
  pollLogState.set(key, { sig, at: now, suppressed: 0 });

  if (isHeartbeat) {
    logPoll(event, { ...data, heartbeat: true, suppressed });
  } else if (suppressed > 0) {
    logPoll(event, { ...data, suppressed });
  } else {
    logPoll(event, data);
  }
}

/** Sólo para tests: olvida lo emitido. */
export function resetPollLogState(): void {
  pollLogState.clear();
}

declare global {
  interface Window {
    __pollDebug?: {
      fetchConversation: (id: string) => Promise<unknown>;
      sessionState: () => Promise<unknown>;
      realtimeState: () => Promise<unknown>;
      forceTokenRefresh: () => Promise<unknown>;
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
        .schema('maity')
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

    /**
     * Fuerza un TOKEN_REFRESHED por el MISMO camino que el refresh horario de
     * auth-js (`_callRefreshToken` → `_notifyAllSubscribers` bajo el lock de
     * sesion). Si el callback de AuthContext volviera a hacer await de
     * supabase-js, esta promesa NUNCA resuelve (deadlock del 2026-09-10); con el
     * fix resuelve en <2 s y el log muestra `fetchOrCreateMaityUser start` → `ok`.
     * Rota el refresh_token: Rust recibe el par nuevo por la siembra de AuthContext.
     */
    forceTokenRefresh: async () => {
      const { supabase } = await import('./supabase');
      const t0 = performance.now();
      const { data, error } = await supabase.auth.refreshSession();
      const elapsedMs = Math.round(performance.now() - t0);
      const expiresAt = data?.session?.expires_at ?? null;
      const result = {
        elapsedMs,
        hasSession: !!data?.session,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        error,
      };
      // eslint-disable-next-line no-console
      console.log('[POLL_DEBUG] forceTokenRefresh', result);
      return result;
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
