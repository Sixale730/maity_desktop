/**
 * Update Service
 *
 * Handles automatic software updates using Tauri updater plugin.
 * Provides update checking, downloading, and installation functionality.
 *
 * Dos canales (ver `UpdateInfo.channel`):
 * - `github`: instalación NSIS → `tauri-plugin-updater` contra `latest.json` de
 *   GitHub Releases; descarga + instala + relaunch.
 * - `store`: instalación MSIX (Microsoft Store) → SOLO avisa. Compara
 *   `getVersion()` contra `maity.system_config['desktop_store_latest_version']`
 *   y, si hay versión nueva, el `UpdateDialog` manda al usuario a la Store
 *   (deep link) y le ofrece cerrar Maity para que la Store aplique el paquete.
 *   Nunca descarga nada: el updater de GitHub dentro del MSIX instalaría el
 *   setup.exe NSIS como segunda copia Win32 (issue #71).
 */

import { check, Update } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { fetchStoreLatestVersion } from '@/lib/storeChannel';
import { isNewerVersion, parseVersion } from '@/lib/versionCompare';

export type UpdateChannel = 'github' | 'store';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  /** Canal por el que llegaría la actualización. `store` = solo aviso, sin descarga. */
  channel?: UpdateChannel;
  version?: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/**
 * Update Service
 * Singleton service for managing app updates
 */
export class UpdateService {
  private updateCheckInProgress = false;
  private lastCheckTime: number | null = null;
  private readonly CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private storeCheckPromise: Promise<boolean> | null = null;
  private masCheckPromise: Promise<boolean> | null = null;

  /**
   * true cuando la app corre bajo identidad de paquete MSIX (instalada desde
   * la Microsoft Store). Ahí las actualizaciones las aplica la Store: si el
   * updater de GitHub corriera, instalaría el setup.exe NSIS como una segunda
   * copia Win32 en paralelo a la de la Store (runFullTrust lo permite).
   *
   * NO incluir aquí el build de Mac App Store: esto selecciona el canal
   * `store`, que compara contra `desktop_store_latest_version` y manda al
   * usuario a `ms-windows-store://`. En una Mac eso es un enlace roto a otra
   * tienda. Ver `isMacAppStoreBuild()`.
   */
  async isManagedByStore(): Promise<boolean> {
    if (this.storeCheckPromise === null) {
      // Wrapper async: convierte un throw síncrono de invoke() (p. ej. fuera
      // de Tauri) en rechazo de promesa que cae al catch de abajo.
      this.storeCheckPromise = (async () =>
        invoke<boolean>('is_running_under_package_identity'))();
    }
    try {
      return await this.storeCheckPromise;
    } catch (error) {
      // Fail-open a instalación clásica (comportamiento actual), pero sin
      // cachear el fallo: un error transitorio de IPC no debe fijar la
      // respuesta por el resto de la sesión.
      this.storeCheckPromise = null;
      logger.warn('[updateService] Package identity check failed — asumo instalación clásica', error);
      return false;
    }
  }

  /**
   * true cuando la app es un build de Mac App Store (sandbox o recibo `_MASReceipt`).
   *
   * Apple prohíbe que una app de la Store se auto-actualice (guideline 2.4.5),
   * y bajo sandbox el updater no podría escribir en `/Applications` aunque lo
   * intentara. A diferencia del MSIX, aquí NO se avisa dentro de la app: la
   * App Store ya notifica al usuario por su cuenta, así que un aviso propio
   * solo añadiría superficie de revisión sin aportar nada.
   */
  async isMacAppStoreBuild(): Promise<boolean> {
    if (this.masCheckPromise === null) {
      this.masCheckPromise = (async () => invoke<boolean>('is_mac_app_store_build'))();
    }
    try {
      return await this.masCheckPromise;
    } catch (error) {
      // Mismo fail-open que el gate de MSIX, y sin cachear el fallo.
      this.masCheckPromise = null;
      logger.warn('[updateService] Mac App Store check failed — asumo instalación directa', error);
      return false;
    }
  }

  /**
   * Check for available updates
   * @param force Force check even if recently checked
   * @returns Promise with update information
   */
  async checkForUpdates(force = false): Promise<UpdateInfo> {
    // Mac App Store: se sale ANTES de resolver canal. No hay canal propio
    // porque no hay nada que hacer — la App Store notifica al usuario por su
    // cuenta y Apple prohíbe auto-actualizarse (guideline 2.4.5). Ojo: NO
    // reutilizar el canal `store`, que es exclusivo del MSIX y mandaría a un
    // deep link `ms-windows-store://` desde una Mac.
    if (await this.isMacAppStoreBuild()) {
      logger.info('[updateService] Skipping check — build de Mac App Store, la App Store gestiona updates');
      void fileLogger.info('updater_service', 'skip-store-managed', { force, platform: 'mac-app-store' });
      return {
        available: false,
        currentVersion: await getVersion(),
      };
    }

    const channel: UpdateChannel = (await this.isManagedByStore()) ? 'store' : 'github';

    // Prevent concurrent update checks
    if (this.updateCheckInProgress) {
      throw new Error('Update check already in progress');
    }

    // Skip if checked recently (unless forced)
    if (!force && this.lastCheckTime) {
      const timeSinceLastCheck = Date.now() - this.lastCheckTime;
      if (timeSinceLastCheck < this.CHECK_INTERVAL_MS) {
        logger.info(`[updateService] Skipping check — checked ${Math.round(timeSinceLastCheck / 1000)}s ago (interval: ${this.CHECK_INTERVAL_MS / 1000}s)`);
        return {
          available: false,
          currentVersion: await getVersion(),
          channel,
        };
      }
    }

    this.updateCheckInProgress = true;

    try {
      const currentVersion = await getVersion();

      if (channel === 'store') {
        return await this.checkStoreChannel(currentVersion, force);
      }

      logger.info(`[updateService] Checking for updates (current: ${currentVersion}, force: ${force})`);
      const update = await check();
      // Solo marcamos cooldown cuando check() retorna sin lanzar. Si falla
      // (red, plugin no listo, etc.) no envenenamos el cooldown 24h y el
      // siguiente intento puede reintentar inmediatamente.
      this.lastCheckTime = Date.now();

      if (update?.available) {
        logger.info(`[updateService] Update available: ${update.version} (current: ${currentVersion})`);
        return {
          available: true,
          currentVersion,
          channel,
          version: update.version,
          date: update.date,
          body: update.body,
        };
      }

      logger.info(`[updateService] No update available (current: ${currentVersion} is latest)`);
      return {
        available: false,
        currentVersion,
        channel,
      };
    } catch (error) {
      // Antes este catch tragaba el error con console.error que nadie miraba.
      // Ahora va al logger que llega a DevTools (dev) + fileLogger que escribe
      // al archivo exportable (prod). Sin el fileLogger este error era invisible
      // en builds de release porque logger.info/debug son no-ops en prod.
      logger.error('[updateService] Update check failed', error);
      void fileLogger.error('updater_service', 'check-failed', {
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.updateCheckInProgress = false;
    }
  }

  /**
   * Canal Store: compara la versión instalada contra la última publicada en la
   * Store (`system_config`). No descarga nada. Lanza en errores de red/RLS
   * (los maneja el catch de `checkForUpdates`, igual que la rama GitHub).
   */
  private async checkStoreChannel(currentVersion: string, force: boolean): Promise<UpdateInfo> {
    logger.info(`[updateService] Canal Store (MSIX): comparando ${currentVersion} contra system_config (force: ${force})`);
    const lookup = await fetchStoreLatestVersion();

    if (lookup.status === 'no-session') {
      // Sin sesión no hay lectura posible (RLS exige `authenticated`). NO se
      // marca cooldown: el re-check al volver al foreground (force=false) debe
      // poder correr en cuanto el usuario inicie sesión.
      logger.info('[updateService] Canal Store: sin sesión Supabase, se reintenta más tarde');
      void fileLogger.info('updater_service', 'store-check-skipped', { reason: 'no-session', force });
      return { available: false, currentVersion, channel: 'store' };
    }

    this.lastCheckTime = Date.now();

    if (lookup.status === 'missing') {
      logger.warn('[updateService] Canal Store: system_config sin desktop_store_latest_version (falta el seed)');
      void fileLogger.warn('updater_service', 'store-check-skipped', { reason: 'missing-key', force });
      return { available: false, currentVersion, channel: 'store' };
    }

    if (parseVersion(lookup.version) === null) {
      logger.warn(`[updateService] Canal Store: valor inválido en system_config: "${lookup.version}"`);
      void fileLogger.warn('updater_service', 'store-check-skipped', { reason: 'invalid-remote', remote: lookup.version, force });
      return { available: false, currentVersion, channel: 'store' };
    }

    if (isNewerVersion(lookup.version, currentVersion)) {
      logger.info(`[updateService] Store update available: ${lookup.version} (current: ${currentVersion})`);
      void fileLogger.info('updater_service', 'store-update-available', { currentVersion, remote: lookup.version, force });
      return { available: true, currentVersion, channel: 'store', version: lookup.version };
    }

    logger.info(`[updateService] Store: ${currentVersion} ya es la última publicada (remota: ${lookup.version})`);
    void fileLogger.info('updater_service', 'store-up-to-date', { currentVersion, remote: lookup.version, force });
    return { available: false, currentVersion, channel: 'store' };
  }

  /**
   * Download and install the available update
   * @param update The update object from checkForUpdates
   * @param onProgress Optional progress callback
   * @returns Promise that resolves when download completes
   */
  async downloadAndInstall(
    update: Update,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void> {
    try {
      // Download the update
      await update.download();

      // Notify progress if callback provided
      if (onProgress) {
        onProgress({ downloaded: 100, total: 100, percentage: 100 });
      }

      // Install and relaunch
      await update.install();
      await relaunch();
    } catch (error) {
      console.error('Failed to download/install update:', error);
      throw error;
    }
  }

  /**
   * Get the current app version
   * @returns Promise with version string
   */
  async getCurrentVersion(): Promise<string> {
    return getVersion();
  }

  /**
   * Check if an update check was performed recently
   * @returns true if checked within the interval
   */
  wasCheckedRecently(): boolean {
    if (!this.lastCheckTime) return false;
    const timeSinceLastCheck = Date.now() - this.lastCheckTime;
    return timeSinceLastCheck < this.CHECK_INTERVAL_MS;
  }
}

// Export singleton instance
export const updateService = new UpdateService();
