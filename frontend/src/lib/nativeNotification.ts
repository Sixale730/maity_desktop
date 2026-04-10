/**
 * Native system notifications using Tauri's notification plugin.
 * Falls back to in-app toast if native notifications are unavailable.
 */

import { toast } from 'sonner';

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
  try {
    const mod = await getModule();
    if (!mod) {
      toast.info(opts.title, { description: opts.body });
      return;
    }

    let permitted = await mod.isPermissionGranted();
    if (!permitted) {
      const result = await mod.requestPermission();
      permitted = result === 'granted';
    }

    if (permitted) {
      await mod.sendNotification({ title: opts.title, body: opts.body });
    } else {
      // Fallback to in-app toast
      toast.info(opts.title, { description: opts.body });
    }
  } catch (err) {
    console.warn('[Notification] Native notification failed, using toast:', err);
    toast.info(opts.title, { description: opts.body });
  }
}
