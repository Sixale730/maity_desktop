import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';

/**
 * Suscripcion segura a eventos de Tauri (issue #65).
 *
 * ## Por que existe
 *
 * `_unlisten` de `@tauri-apps/api/event` llama al script que Tauri inyecta en
 * el webview (`tauri/src/event/mod.rs`), que hace:
 *
 * ```js
 * const listeners = (window['<listeners_obj>'] || {})[event]
 * if (listeners) { window.__TAURI_INTERNALS__.unregisterCallback(listeners[eventId].handlerId) }
 * ```
 *
 * El guard prueba la BOLSA del evento — creada con `Object.defineProperty` no
 * configurable, o sea que existe para siempre en cuanto alguien se suscribio
 * una vez — pero despues dereferencia la ENTRADA del eventId, que si se borra.
 * Resultado: con la bolsa ya creada, cualquier unlisten cuya entrada no este
 * presente truena con `Cannot read properties of undefined (reading 'handlerId')`.
 * Y como `_unlisten` es async y nadie le ponia `.catch()`, salia como
 * `unhandledrejection` — invisible salvo por la telemetria de `app.error`.
 *
 * ## Los tres invariantes (son el arreglo, no adornos)
 *
 * 1. **Latch idempotente**: un segundo `dispose()` es no-op, no un TypeError.
 * 2. **Cancel-safe**: si `listen()` resuelve DESPUES del dispose, se libera de
 *    inmediato en vez de quedar colgado. Sin esto, desmontar antes de que
 *    resuelva el `await` deja el listener vivo para siempre.
 * 3. **Nunca rechaza**: `.catch()` en el `listen()` y en cada `unlisten()`.
 *    Esto es lo que impide que un unlisten tardio durante el cierre de la app
 *    vuelva a producir un `unhandledrejection`.
 *
 * Reemplaza a mano el patron `let un; (async () => { un = await listen(...) })();
 * return () => un?.()`, que perdia el listener si el cleanup ganaba la carrera.
 */

/** Invoca un unlisten sin dejar que su fallo escape como unhandledrejection. */
function safeUnlisten(fn: UnlistenFn): void {
  try {
    const maybePromise = fn() as unknown;
    // `_unlisten` es async: sin este catch, un rechazo tardio (tipico al cerrar
    // la app, cuando el backend ya no responde) vuelve a ser un unhandledrejection.
    if (maybePromise && typeof (maybePromise as PromiseLike<unknown>).then === 'function') {
      void (maybePromise as Promise<unknown>).catch((err) => {
        logger.debug('[tauriSubscribe] unlisten fallo (ignorado):', err);
      });
    }
  } catch (err) {
    logger.debug('[tauriSubscribe] unlisten lanzo (ignorado):', err);
  }
}

/**
 * Grupo de suscripciones con disposicion idempotente. Para efectos que montan
 * VARIOS listeners.
 *
 * ```ts
 * useEffect(() => {
 *   const subs = createSubscriptionGroup();
 *   subs.add(recordingService.onRecordingStarted(cb));
 *   subs.add(recordingService.onRecordingStopped(cb));
 *   return () => subs.dispose();
 * }, []);
 * ```
 *
 * Nota: `add` NO espera. Los `listen()` arrancan en paralelo, a diferencia del
 * patron viejo con `await` secuencial dentro de un IIFE async.
 */
export function createSubscriptionGroup() {
  let disposed = false;
  const unsubs: UnlistenFn[] = [];

  /**
   * Registra la promesa de un `listen()`. Si el grupo ya se desecho cuando
   * resuelve, libera de inmediato en vez de acumular un listener zombi.
   */
  const add = (p: Promise<UnlistenFn>): void => {
    void p.then(
      (fn) => {
        if (disposed) {
          safeUnlisten(fn);
        } else {
          unsubs.push(fn);
        }
      },
      (err) => {
        // El listen() fallo: no hay nada que liberar.
        logger.debug('[tauriSubscribe] listen fallo:', err);
      },
    );
  };

  return {
    add,

    /**
     * Azucar sobre `add(listen(...))`. Existe para que los call sites NO
     * necesiten importar `listen` de `@tauri-apps/api/event` — asi la regla de
     * lint que prohibe ese import puede ser absoluta fuera de este modulo.
     * Se define con arrow + closure (no `this`) para que sobreviva al destructuring.
     */
    on: <T>(event: string, handler: (e: Event<T>) => void): void => {
      add(listen<T>(event, handler));
    },

    /** Idempotente: la segunda llamada no hace nada. */
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      // splice(0) vacia el array al mismo tiempo que lo recorre, asi que ni
      // siquiera una llamada re-entrante podria volver a invocar los mismos fns.
      for (const fn of unsubs.splice(0)) safeUnlisten(fn);
    },

    /** Solo para tests/diagnostico. */
    get isDisposed(): boolean {
      return disposed;
    },
  };
}

/**
 * Suscripcion a UN evento. Devuelve el disposer de forma SINCRONA (sin esperar
 * a que resuelva `listen()`), asi que se puede usar directo como return de un
 * `useEffect`:
 *
 * ```ts
 * useEffect(() => subscribeTauriEvent(TauriEvent.FOO, handler), []);
 * ```
 */
export function subscribeTauriEvent<T>(
  event: string,
  handler: (e: Event<T>) => void,
): () => void {
  const group = createSubscriptionGroup();
  group.on<T>(event, handler);
  return () => group.dispose();
}

/**
 * Variante para APIs que ya devuelven la promesa de un unlisten pero no pasan
 * por `listen()` — p. ej. `getCurrentWindow().onCloseRequested(...)`.
 */
export function subscribeUnlisten(p: Promise<UnlistenFn>): () => void {
  const group = createSubscriptionGroup();
  group.add(p);
  return () => group.dispose();
}
