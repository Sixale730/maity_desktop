'use client';

/**
 * Store de niveles de audio (mic/sistema) FUERA de React (issue #07 de la
 * auditoría de recursos).
 *
 * Por qué: coach-float y recording-widget recibían niveles de audio a
 * 10-20 Hz vía `useState` en el componente de PÁGINA COMPLETA. Cada tick
 * disparaba un re-render del árbol entero (~70 nodos), y como las barras de
 * nivel viven debajo de un `backdrop-filter: blur(22px)`, cada mutación de
 * altura invalidaba y recomponía el blur — por CPU en equipos sin GPU
 * dedicada (~36,000 renders/hora en el peor caso).
 *
 * Este módulo es un store de módulo (singleton, fuera del árbol de React)
 * con el patrón `subscribe`/`getSnapshot` de `useSyncExternalStore`: solo el
 * componente hoja que realmente pinta las barras (`AudioLevelBars`) se
 * suscribe, así que un tick de audio ya NO re-renderiza la página completa.
 *
 * Reglas de diseño:
 * - Los listeners de Tauri se adjuntan al PRIMER suscriptor y se sueltan con
 *   el ÚLTIMO (ref-count por Set, no por componente) — si mic Y sistema
 *   montan cada uno su propio `AudioLevelBars`, solo hay UN par de listeners
 *   Tauri vivo en total.
 * - Epsilon: un delta menor a 1e-3 en AMBOS canales no dispara notificación.
 *   Rust emite el mismo valor (silencio) decenas de veces por segundo; sin
 *   este filtro, "silencio absoluto" seguiría re-renderizando a 10-20 Hz.
 * - Coalescing con requestAnimationFrame + tope de 4 Hz: el ojo humano no
 *   distingue una barra de nivel actualizándose más rápido que eso.
 * - `getSnapshot()` devuelve SIEMPRE la MISMA referencia mientras el valor
 *   no cambie. `useSyncExternalStore` compara por `Object.is` en cada
 *   render para decidir si hay que re-renderizar; devolver un objeto nuevo
 *   en cada llamada es el error clásico que produce un bucle infinito
 *   (React re-renderiza → llama a getSnapshot → ve "otra referencia" → cree
 *   que cambió → re-renderiza → ...).
 *
 * Nota sobre el import directo de `listen`: el resto del código usa
 * `createSubscriptionGroup`/`subscribeTauriEvent` de `@/lib/tauriSubscribe`
 * (issue #65 — evita un doble-unlisten que revienta como
 * unhandledrejection). Ese helper está pensado para "monta N listeners
 * dentro de un useEffect de UN componente, suéltalos juntos al desmontar" —
 * un ciclo de vida 1:1 con un efecto. Este store no tiene ese ciclo de
 * vida: el ref-count de suscriptores sube y baja entre MUCHOS componentes
 * hoja independientes (barras de mic + barras de sistema, en dos ventanas
 * Tauri distintas), y el mismo par de listeners debe sobrevivir mientras
 * exista AL MENOS UNO de ellos. Por eso este módulo importa `listen`
 * directo y reimplementa (no reexporta — es privada en tauriSubscribe.ts)
 * la misma defensa de "no dejar que un unlisten fallido escape como
 * unhandledrejection". Este archivo está en la lista blanca de
 * `no-restricted-imports` (.eslintrc.json) y de la fitness function de
 * `tauriSubscribe.test.ts`, igual que `services/recordingService.ts`.
 */

import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { TauriEvent } from '@/lib/tauri-events';
import { logger } from '@/lib/logger';

export interface AudioLevelsSnapshot {
  micRms: number;
  sysRms: number;
}

interface RecordingAudioLevelsPayload {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

interface AudioLevelsBroadcastPayload {
  timestamp: number;
  levels: Array<{
    device_name: string;
    device_type: string; // 'input' | 'output'
    rms_level: number;
    peak_level: number;
    is_active: boolean;
  }>;
}

/** Delta mínimo (en cualquiera de los dos canales) para considerar que el nivel "cambió de verdad". */
const EPSILON = 1e-3;
/** Tope de notificaciones a los suscriptores: 4 por segundo. */
const MAX_NOTIFY_HZ = 4;
const MIN_NOTIFY_INTERVAL_MS = 1000 / MAX_NOTIFY_HZ;

const ZERO_SNAPSHOT: AudioLevelsSnapshot = { micRms: 0, sysRms: 0 };

// Snapshot PUBLICADO — la referencia que devuelve getSnapshot(). Solo se
// reemplaza cuando el valor realmente cambia (ver nota "CRÍTICO" del header).
let snapshot: AudioLevelsSnapshot = ZERO_SNAPSHOT;

// Últimos valores crudos recibidos de Tauri, pendientes de aplicar en el
// próximo frame coalescido.
let pendingMic = 0;
let pendingSys = 0;

const subscribers = new Set<() => void>();
let unlistenFns: UnlistenFn[] = [];
let rafId: number | null = null;
let lastNotifyAt = 0;

/** Invoca un unlisten sin dejar que su fallo escape como unhandledrejection (mismo hazard que issue #65). */
function safeUnlisten(fn: UnlistenFn): void {
  try {
    const maybePromise = fn() as unknown;
    if (maybePromise && typeof (maybePromise as PromiseLike<unknown>).then === 'function') {
      void (maybePromise as Promise<unknown>).catch((err) => {
        logger.debug('[audioLevelsStore] unlisten fallo (ignorado):', err);
      });
    }
  } catch (err) {
    logger.debug('[audioLevelsStore] unlisten lanzo (ignorado):', err);
  }
}

function notifySubscribers(): void {
  subscribers.forEach((cb) => cb());
}

function applyPending(): void {
  const dMic = Math.abs(pendingMic - snapshot.micRms);
  const dSys = Math.abs(pendingSys - snapshot.sysRms);
  if (dMic < EPSILON && dSys < EPSILON) return; // silencio sostenido: no-op, sin notificar
  snapshot = { micRms: pendingMic, sysRms: pendingSys };
  notifySubscribers();
}

function scheduleNotify(): void {
  if (rafId !== null) return; // ya hay un frame coalescido pendiente
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const now = performance.now();
    if (now - lastNotifyAt < MIN_NOTIFY_INTERVAL_MS) {
      // Todavía dentro de la ventana de 4 Hz: reprogramar para el próximo
      // frame en vez de descartar el update (Rust sigue emitiendo a 10-20 Hz
      // y queremos que el último valor eventualmente se pinte).
      scheduleNotify();
      return;
    }
    lastNotifyAt = now;
    applyPending();
  });
}

function setLevels(micRms: number, sysRms: number): void {
  pendingMic = micRms;
  pendingSys = sysRms;
  scheduleNotify();
}

async function attachListeners(): Promise<void> {
  try {
    const un = await listen<RecordingAudioLevelsPayload>(
      TauriEvent.RECORDING_AUDIO_LEVELS,
      (e: Event<RecordingAudioLevelsPayload>) => {
        setLevels(e.payload.micRms, e.payload.sysRms);
      },
    );
    unlistenFns.push(un);
  } catch (err) {
    logger.debug('[audioLevelsStore] listen recording-audio-levels fallo:', err);
  }

  try {
    // El monitor de niveles (preview, independiente de grabar) trae AMBOS
    // canales — input (mic vía CPAL) y output (sistema vía WASAPI
    // loopback/CoreAudio). Filtramos por device_type para popular cada
    // barra. En Linux o macOS sin permiso, el canal de salida llega con
    // rms_level=0 (graceful).
    const un = await listen<AudioLevelsBroadcastPayload>(
      TauriEvent.AUDIO_LEVELS,
      (e: Event<AudioLevelsBroadcastPayload>) => {
        const inputLvl = e.payload.levels.find((l) => l.device_type === 'input');
        const outputLvl = e.payload.levels.find((l) => l.device_type === 'output');
        setLevels(inputLvl?.rms_level ?? 0, outputLvl?.rms_level ?? 0);
      },
    );
    unlistenFns.push(un);
  } catch (err) {
    logger.debug('[audioLevelsStore] listen audio-levels fallo:', err);
  }
}

function detachListeners(): void {
  const fns = unlistenFns;
  unlistenFns = [];
  fns.forEach(safeUnlisten);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  // Reset para el próximo ciclo de suscripción: sin esto, un consumidor que
  // vuelva a montar vería el último nivel de la sesión anterior como
  // snapshot inicial en vez de silencio real.
  pendingMic = 0;
  pendingSys = 0;
  snapshot = ZERO_SNAPSHOT;
}

/**
 * Se suscribe al store. Adjunta los listeners de Tauri en el primer
 * suscriptor y los suelta cuando el último se desuscribe. Referencia
 * ESTABLE (no crear un wrapper nuevo por render) — es la que se le pasa a
 * `useSyncExternalStore`.
 */
export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  if (subscribers.size === 1) {
    void attachListeners();
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      detachListeners();
    }
  };
}

export function getSnapshot(): AudioLevelsSnapshot {
  return snapshot;
}

/** subscribe/getSnapshot no-op para el consumidor con `enabled: false`. */
function noopSubscribe(): () => void {
  return () => {};
}
function getZeroSnapshot(): AudioLevelsSnapshot {
  return ZERO_SNAPSHOT;
}

/**
 * Hook de lectura del store. Con `enabled: false` no se suscribe a nada
 * (subscribe/getSnapshot no-op) → cero listeners Tauri y cero re-renders en
 * reposo para un consumidor que no necesita niveles en este momento.
 */
export function useAudioLevels({ enabled }: { enabled: boolean }): AudioLevelsSnapshot {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    enabled ? getSnapshot : getZeroSnapshot,
    // getServerSnapshot: `next build` (output:'export') prerenderiza estas
    // páginas 'use client' igual — sin este tercer argumento React tira en
    // build "Missing getServerSnapshot". Los niveles solo existen client-side
    // (eventos Tauri en vivo), así que cero es el único valor correcto.
    getZeroSnapshot,
  );
}

/**
 * Fuerza los niveles a cero de inmediato, sin esperar al próximo evento de
 * Tauri ni al throttle de 4 Hz. Los callers de página lo invocan al detener
 * grabación — replica el `setLevels({ micRms: 0, sysRms: 0 })` explícito
 * que hacían coach-float/recording-widget antes de este refactor. Las
 * barras siguen MONTADAS entre grabaciones (nunca llegan a 0 suscriptores),
 * así que el reset automático de `detachListeners` no dispara solo: sin
 * esta función, las barras mostrarían el último nivel de la sesión que
 * acaba de terminar hasta que llegue el siguiente evento del preview.
 */
export function resetAudioLevels(): void {
  pendingMic = 0;
  pendingSys = 0;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (snapshot.micRms === 0 && snapshot.sysRms === 0) return; // ya en cero
  snapshot = ZERO_SNAPSHOT;
  lastNotifyAt = performance.now();
  notifySubscribers();
}
