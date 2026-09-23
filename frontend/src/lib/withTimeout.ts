/** Error de `withTimeout`: la operación no respondió en el plazo (distinguible con `instanceof`). */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timeout (${ms}ms)`)
    this.name = 'TimeoutError'
  }
}

/**
 * Rechaza con `TimeoutError` si `promise` no se resuelve en `ms`. Red de seguridad
 * para llamadas de supabase-js que pueden colgarse para siempre sin error (deadlock
 * del lock de auth, incidente 2026-09-10: el chat "no hacía nada" al primer refresh
 * horario).
 *
 * No cancela la operación de fondo (supabase-js no acepta AbortSignal en todas sus
 * rutas): solo deja de esperarla para que la UI pueda mostrar un error.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
