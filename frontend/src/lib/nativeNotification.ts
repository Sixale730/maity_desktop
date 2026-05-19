/**
 * Native system notifications using Tauri's notification plugin.
 * Falls back to in-app toast if native notifications are unavailable.
 *
 * Instrumented with logger.warn at every exit path so a console capture
 * reveals exactly where the flow breaks (module unavailable, permission
 * denied, sendNotification throws, etc.).
 *
 * `actionTypeId` (US-4 del plan autostart): si la notif se envía con un `actionTypeId`
 * registrado vía `registerNotificationActionHandler`, se añade un botón de acción "Abrir
 * Maity" y al clickearlo se invoca el handler asociado. Usado para el flow "stop con main
 * minimizada → notif → click → restaurar ventana + mostrar modal feedback".
 */

import { toast } from 'sonner';
import { logger } from '@/lib/logger';

let notificationModule: typeof import('@tauri-apps/plugin-notification') | null = null;
let listenerInitialized = false;
const actionHandlers = new Map<string, () => void | Promise<void>>();
// El plugin retorna un PluginListener (objeto con `.unregister()`), no una función. Guardamos
// el listener completo y le llamamos `.unregister()` desde el cleanup. `unknown` evita acoplar
// la API interna del plugin en la type signature pública.
let onActionListener: { unregister: () => Promise<void> } | null = null;

async function getModule() {
  if (!notificationModule) {
    try {
      notificationModule = await import('@tauri-apps/plugin-notification');
    } catch {
      notificationModule = null;
    }
  }
  return notificationModule;
}

/**
 * Registra un handler que se ejecuta cuando el usuario clickea el botón "Abrir Maity" de
 * una notif enviada con el `actionTypeId` correspondiente. La primera llamada inicializa
 * el `registerActionTypes` y el listener global `onAction` del plugin. Idempotente: re-
 * llamadas con el mismo `actionTypeId` sobrescriben el handler.
 */
export async function registerNotificationActionHandler(
  actionTypeId: string,
  handler: () => void | Promise<void>,
): Promise<void> {
  actionHandlers.set(actionTypeId, handler);
  await ensureListenerInitialized();
}

async function ensureListenerInitialized(): Promise<void> {
  if (listenerInitialized) {
    // Refrescar action types con los nuevos handlers registrados.
    await syncRegisteredActionTypes();
    return;
  }

  const mod = await getModule();
  if (!mod) {
    logger.warn('[NativeNotification] cannot init action listener: module unavailable');
    return;
  }

  try {
    await syncRegisteredActionTypes();

    onActionListener = await mod.onAction((event) => {
      // El `actionTypeId` de la notif clickeada nos dice qué handler invocar.
      // Algunos OS (Windows Action Center) llaman a onAction al click directo del cuerpo,
      // otros (macOS) solo al botón de acción. En ambos casos `event.actionTypeId` debe
      // venir poblado porque registramos la notif con uno.
      const typeId = event.actionTypeId;
      if (!typeId) {
        logger.warn('[NativeNotification] onAction without actionTypeId, ignoring');
        return;
      }
      const handler = actionHandlers.get(typeId);
      if (handler) {
        void Promise.resolve(handler()).catch((err) =>
          logger.warn(`[NativeNotification] handler for "${typeId}" threw:`, err),
        );
      } else {
        logger.warn(`[NativeNotification] no handler registered for "${typeId}"`);
      }
    });

    listenerInitialized = true;
  } catch (err) {
    logger.warn('[NativeNotification] action listener init failed:', err);
  }
}

async function syncRegisteredActionTypes(): Promise<void> {
  const mod = await getModule();
  if (!mod) return;
  try {
    const types = Array.from(actionHandlers.keys()).map((id) => ({
      id,
      actions: [{ id: 'open', title: 'Abrir Maity' }],
    }));
    if (types.length > 0) {
      await mod.registerActionTypes(types);
    }
  } catch (err) {
    logger.warn('[NativeNotification] registerActionTypes failed:', err);
  }
}

/**
 * Cleanup global del listener. No se llama en runtime normal — solo para tests.
 */
export function _resetNotificationActionHandlersForTests(): void {
  actionHandlers.clear();
  if (onActionListener) {
    void onActionListener.unregister();
    onActionListener = null;
  }
  listenerInitialized = false;
}

/**
 * Send a native macOS/Windows notification.
 * Falls back to in-app toast if permissions denied or plugin unavailable.
 *
 * Si se pasa `actionTypeId` (registrado vía `registerNotificationActionHandler`), la
 * notif tendrá un botón "Abrir Maity"; al clickearlo se invoca el handler asociado.
 */
export async function sendNativeNotification(opts: {
  title: string;
  body: string;
  actionTypeId?: string;
}) {
  logger.warn(`[NativeNotification] CALLED title="${opts.title}" actionTypeId="${opts.actionTypeId ?? ''}"`);
  try {
    const mod = await getModule();
    if (!mod) {
      logger.warn('[NativeNotification] FALLBACK: plugin module unavailable, using toast');
      toast.info(opts.title, { description: opts.body });
      return;
    }

    let permitted = await mod.isPermissionGranted();
    logger.warn(`[NativeNotification] isPermissionGranted=${permitted}`);

    if (!permitted) {
      const result = await mod.requestPermission();
      logger.warn(`[NativeNotification] requestPermission result=${result}`);
      permitted = result === 'granted';
    }

    if (permitted) {
      logger.warn('[NativeNotification] CALLING sendNotification');
      const payload: Parameters<typeof mod.sendNotification>[0] = {
        title: opts.title,
        body: opts.body,
      };
      if (opts.actionTypeId) {
        payload.actionTypeId = opts.actionTypeId;
      }
      await mod.sendNotification(payload);
      logger.warn('[NativeNotification] sendNotification RETURNED ok');
    } else {
      logger.warn('[NativeNotification] FALLBACK: permission denied, using toast');
      toast.info(opts.title, { description: opts.body });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[NativeNotification] EXCEPTION: ${msg}`);
    toast.info(opts.title, { description: opts.body });
  }
}
