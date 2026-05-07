import { useEffect, useState } from 'react';
import { updateService, UpdateInfo } from '@/services/updateService';
import { showUpdateNotification } from '@/components/updates/UpdateNotification';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';

interface UseUpdateCheckOptions {
  checkOnMount?: boolean;
  showNotification?: boolean;
  onUpdateAvailable?: (info: UpdateInfo) => void;
}

export function useUpdateCheck(options: UseUpdateCheckOptions = {}) {
  const {
    checkOnMount = true,
    showNotification = true,
    onUpdateAvailable,
  } = options;

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkForUpdates = async (force = false) => {
    // Skip if checked recently (unless forced)
    if (!force && updateService.wasCheckedRecently()) {
      logger.debug('[useUpdateCheck] Skip — wasCheckedRecently=true (force=false)');
      void fileLogger.info('updater', 'skip-recent', { force });
      return;
    }

    logger.info(`[useUpdateCheck] Starting check (force=${force})`);
    void fileLogger.info('updater', 'check-start', { force });
    setIsChecking(true);
    try {
      const info = await updateService.checkForUpdates(force);
      setUpdateInfo(info);

      void fileLogger.info('updater', 'check-result', {
        available: info.available,
        currentVersion: info.currentVersion,
        newVersion: info.version ?? null,
      });

      if (info.available) {
        logger.info(`[useUpdateCheck] Update found: ${info.version}`);
        if (onUpdateAvailable) {
          void fileLogger.info('updater', 'invoke-callback', { newVersion: info.version });
          onUpdateAvailable(info);
        } else if (showNotification) {
          void fileLogger.info('updater', 'show-default-toast', { newVersion: info.version });
          showUpdateNotification(info, () => {
            // This will be handled by the component that uses this hook
          });
        }
      } else {
        logger.info(`[useUpdateCheck] No update available (current: ${info.currentVersion})`);
      }
    } catch (error) {
      // El service ya hace logger.error con el detalle. Aqui solo dejamos
      // rastro local del path para que el grep en logs muestre el flujo.
      logger.error('[useUpdateCheck] Update check threw — see updateService log');
      void fileLogger.error('updater', 'check-threw', {
        message: error instanceof Error ? error.message : String(error),
      });
      // Silently fail on startup checks to avoid disrupting user experience
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (checkOnMount) {
      // Delay para que el IPC bridge de Tauri termine de inicializar antes
      // del primer check(). En v0.2.43 esto era 500ms y el toast no aparecia
      // al arranque porque el provider mountea al boot de la app y check()
      // corria antes de que la IPC estuviera lista — el error caia en el
      // catch silenciosamente. 2000ms (mismo valor pre-Feb 2026) es el
      // buffer probado que evita la race con la IPC.
      const timer = setTimeout(() => {
        checkForUpdates(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [checkOnMount]);

  return {
    updateInfo,
    isChecking,
    checkForUpdates,
  };
}
