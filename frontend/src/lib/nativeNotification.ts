/**
 * Native system notifications using Tauri's notification plugin.
 * Falls back to in-app toast if native notifications are unavailable.
 *
 * Instrumented with logger.warn at every exit path so a console capture
 * reveals exactly where the flow breaks (module unavailable, permission
 * denied, sendNotification throws, etc.).
 */

import { toast } from 'sonner';
import { logger } from '@/lib/logger';

let notificationModule: typeof import('@tauri-apps/plugin-notification') | null = null;

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
 * Send a native macOS/Windows notification.
 * Falls back to in-app toast if permissions denied or plugin unavailable.
 */
export async function sendNativeNotification(opts: {
  title: string;
  body: string;
}) {
  logger.warn(`[NativeNotification] CALLED title="${opts.title}"`);
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
      await mod.sendNotification({ title: opts.title, body: opts.body });
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
