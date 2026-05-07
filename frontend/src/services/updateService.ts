/**
 * Update Service
 *
 * Handles automatic software updates using Tauri updater plugin.
 * Provides update checking, downloading, and installation functionality.
 */

import { check, Update } from '@tauri-apps/plugin-updater';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
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

  /**
   * Check for available updates
   * @param force Force check even if recently checked
   * @returns Promise with update information
   */
  async checkForUpdates(force = false): Promise<UpdateInfo> {
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
        };
      }
    }

    this.updateCheckInProgress = true;

    try {
      const currentVersion = await getVersion();
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
          version: update.version,
          date: update.date,
          body: update.body,
        };
      }

      logger.info(`[updateService] No update available (current: ${currentVersion} is latest)`);
      return {
        available: false,
        currentVersion,
      };
    } catch (error) {
      // Antes este catch tragaba el error con console.error que nadie miraba.
      // Ahora va al logger que llega a DevTools (dev) + fileLogger que escribe
      // al archivo exportable (prod). Sin el fileLogger este error era invisible
      // en builds de release porque logger.info/debug son no-ops en prod.
      logger.error('[updateService] Update check failed', error);
      void fileLogger.error('updater_service', 'check-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.updateCheckInProgress = false;
    }
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
