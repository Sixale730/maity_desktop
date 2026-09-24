/**
 * Bandera de "post-proceso en vuelo" tras detener una grabación (B2, #83).
 *
 * Qué protege: el update NSIS (`direct_update_install`) termina el proceso con
 * `std::process::exit(0)`. Tras `drop(stop_gate)` en Rust la fase ya es Idle,
 * pero el JS sigue guardando la reunión (streaming) o el lote sigue
 * transcribiendo; si el update corriera en ese hueco se perdería la reunión.
 * `useRecordingStop` marca el inicio y el fin del stop y el `UpdateDialog` se
 * niega a instalar mientras la bandera esté en vuelo.
 *
 * Por qué es un módulo y no un contexto de React: `UpdateCheckProvider` (que
 * monta el diálogo) vive FUERA de `RecordingStateProvider` en
 * `app/(main)/layout.tsx`, así que no puede leer ese contexto.
 */

/** Tope de seguridad: una bandera más vieja que esto se considera rancia (un stop colgado no bloquea updates para siempre). */
export const POST_STOP_MAX_MS = 15 * 60 * 1000;

let inFlight = 0;
let lastBeganAt = 0;

/** Marca el inicio de un stop (guardado/transcripción posterior en curso). */
export function beginPostStop(now: number = Date.now()): void {
  inFlight += 1;
  lastBeganAt = now;
}

/** Marca el fin de un stop; nunca baja de cero. */
export function endPostStop(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** true si hay un stop en vuelo que no está rancio. */
export function isPostStopInFlight(now: number = Date.now()): boolean {
  return inFlight > 0 && now - lastBeganAt < POST_STOP_MAX_MS;
}
