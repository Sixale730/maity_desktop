/**
 * Utilidades para errores de cuota de plan (prefijo `quota:` de finalize.rs).
 *
 * El backend Rust devuelve `Err("quota:{json}")` cuando la nube rechaza el
 * finalize con 403 QUOTA_EXCEEDED. Este módulo centraliza el parseo, el
 * cálculo del siguiente período de cuota y una memoria de sesión para cortar
 * loops de auto-retry (stuckRescue / failed-retry / stuck-watcher).
 */

export const PRICING_URL = 'https://www.maity.cloud/pricing';

export interface QuotaErrorInfo {
  message: string;
  feature?: string;
  used?: number;
  limit?: number;
  period?: string;
}

const QUOTA_PREFIX = 'quota:';
const FALLBACK_MESSAGE =
  'Alcanzaste el límite de análisis de tu plan. La minuta se genera igual.';

/**
 * Devuelve la info de cuota si el error viene con prefijo `quota:`, o null si
 * es cualquier otro error. Tolera JSON inválido tras el prefijo.
 */
export function parseQuotaError(raw: unknown): QuotaErrorInfo | null {
  const text =
    typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : null;
  if (!text || !text.startsWith(QUOTA_PREFIX)) return null;

  const payload = text.slice(QUOTA_PREFIX.length);
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      message:
        typeof parsed.message === 'string' && parsed.message
          ? parsed.message
          : FALLBACK_MESSAGE,
      feature: typeof parsed.feature === 'string' ? parsed.feature : undefined,
      used: typeof parsed.used === 'number' ? parsed.used : undefined,
      limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
      period: typeof parsed.period === 'string' ? parsed.period : undefined,
    };
  } catch {
    return { message: payload || FALLBACK_MESSAGE };
  }
}

/**
 * Calcula el próximo despertar del job diferido por cuota, en el formato que
 * compara get_ready_jobs: `'YYYY-MM-DD HH:MM:SS'` UTC (separador espacio).
 * NO usar toISOString() crudo: la 'T' ordena después de ' ' y el job dormiría
 * hasta el día UTC siguiente.
 * - 'daily'   → siguiente medianoche UTC (el período de la cuota es día UTC).
 * - 'monthly' → día 1 del mes siguiente 00:00 UTC.
 * - otro      → ahora + 6 horas (reintento conservador).
 */
export function nextQuotaRetrySqlite(
  period: string | undefined,
  now: Date = new Date()
): string {
  let retry: Date;
  if (period === 'daily') {
    retry = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
  } else if (period === 'monthly') {
    retry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  } else {
    retry = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  }
  return toSqliteUtc(retry);
}

/** `'YYYY-MM-DD HH:MM:SS'` UTC — formato comparable con datetime('now') en SQLite. */
export function toSqliteUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Memoria de sesión: conversaciones bloqueadas por cuota. Solo evita que los
// auto-retries (stuckRescue, failed-retry, stuck-watcher) vuelvan a pegar la
// cuota dentro de la misma sesión; no persiste (tras la fase 1 web el 403
// desaparece y este camino queda residual).
// ---------------------------------------------------------------------------

const quotaBlockedUntil = new Map<string, number>();

export function markQuotaBlocked(
  conversationId: string,
  period?: string
): void {
  const now = new Date();
  const expiresMs =
    period === 'monthly'
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  quotaBlockedUntil.set(conversationId, expiresMs);
}

export function isQuotaBlocked(conversationId: string): boolean {
  const expires = quotaBlockedUntil.get(conversationId);
  if (expires === undefined) return false;
  if (Date.now() >= expires) {
    quotaBlockedUntil.delete(conversationId);
    return false;
  }
  return true;
}
