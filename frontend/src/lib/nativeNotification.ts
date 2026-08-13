/**
 * Notificaciones nativas del sistema (Windows/macOS), con fallback a toast in-app.
 *
 * NO usa `@tauri-apps/plugin-notification`. El plugin es inutilizable bajo identidad de
 * paquete (MSIX/Microsoft Store): su `NotificationBuilder::show()` fija el `app_id` del toast
 * a `config.identifier` ("com.maity.ai"), pero bajo MSIX el AUMID real es
 * `Sixale.Maity_q5b9hqhck1xz0!Maity` y Windows rechaza un AUMID ajeno. Peor: el error se
 * tragaba DOS veces — en Rust por el `let _ = notification.show()` dentro de un `spawn`, y en
 * JS porque `sendNotification()` es SÍNCRONA y no devuelve la promesa del invoke. Resultado:
 * log en verde, cero toast, y ni siquiera saltaba este fallback.
 *
 * Hoy todo pasa por el comando `send_native_notification` (ver `notifications/toast.rs`), que
 * resuelve el AUMID en runtime y devuelve un `Result` real.
 */

import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

/**
 * Muestra una notificación nativa del SO. Si el OS la rechaza, cae a un toast in-app.
 *
 * `actionTypeId` se acepta y se IGNORA: el plugin de Tauri nunca soportó action buttons en
 * desktop (`register_action_types` / `onAction` solo se registran en mobile), así que el botón
 * "Abrir Maity" jamás llegó a renderizarse en Windows ni macOS. Se mantiene en la firma para no
 * tocar los call sites. Bajo MSIX, Windows suele activar la app por AUMID al clickear el cuerpo
 * del toast, y `tauri_plugin_single_instance` ya restaura la ventana `main`.
 */
export async function sendNativeNotification(opts: {
  title: string;
  body: string;
  actionTypeId?: string;
}) {
  try {
    // Comando propio de la app => NO pasa por el ACL de plugins de Tauri, así que también
    // funciona desde las ventanas auxiliares (coach-float, recording-widget, device-picker),
    // cuyas capabilities no incluyen `notification:default`.
    await invoke('send_native_notification', {
      title: opts.title,
      body: opts.body,
      actionTypeId: opts.actionTypeId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A DIFERENCIA del camino viejo, este catch SÍ se dispara cuando el OS rechaza el toast.
    logger.warn(`[NativeNotification] nativa falló, fallback a toast in-app: ${msg}`);
    toast.info(opts.title, { description: opts.body });
  }
}

/**
 * No-op conservado por compatibilidad de firma.
 *
 * Los action buttons de notificación son mobile-only en `tauri-plugin-notification`: en
 * desktop el plugin solo registra `notify`, `request_permission` e `is_permission_granted`, así
 * que `registerActionTypes`/`onAction` siempre rechazaron y el handler nunca se invocó. Se deja
 * como no-op para no tocar `layout.tsx`. Si algún día se quiere click-para-abrir garantizado
 * bajo MSIX hace falta un COM activator (`windows.toastNotificationActivation` + CLSID +
 * `INotificationActivationCallback`), lo que implica tocar el `Package.appxmanifest` y una
 * nueva submission a la Store.
 */
export async function registerNotificationActionHandler(
  _actionTypeId: string,
  _handler: () => void | Promise<void>,
): Promise<void> {
  // no-op
}

/** No-op; se conserva para los imports existentes. */
export function _resetNotificationActionHandlersForTests(): void {
  // no-op
}
