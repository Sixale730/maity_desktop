import { useEffect, useState } from 'react';
import { updateService, UpdateInfo } from '@/services/updateService';
import { showUpdateNotification } from '@/components/updates/UpdateNotification';
import { logger } from '@/lib/logger';

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
      return;
    }

    logger.info(`[useUpdateCheck] Starting check (force=${force})`);
    setIsChecking(true);
    try {
      const info = await updateService.checkForUpdates(force);
      setUpdateInfo(info);

      if (info.available) {
        logger.info(`[useUpdateCheck] Update found: ${info.version}`);
        if (onUpdateAvailable) {
          onUpdateAvailable(info);
        } else if (showNotification) {
          showUpdateNotification(info, () => {
            // This will be handled by the component that uses this hook
          });
        }
      } else {
        logger.info(`[useUpdateCheck] No update available (current: ${info.currentVersion})`);
      }
    } catch (_error) {
      // El service ya hace logger.error con el detalle. Aqui solo dejamos
      // rastro local del path para que el grep en logs muestre el flujo.
      logger.error('[useUpdateCheck] Update check threw — see updateService log');
      // Silently fail on startup checks to avoid disrupting user experience
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (checkOnMount) {
      // Delay minimo para no spamear el server durante hot-reload del dev server.
      // check() es async no-bloqueante, asi que no hay razon para esperar mas.
      const timer = setTimeout(() => {
        checkForUpdates(false);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [checkOnMount]);

  return {
    updateInfo,
    isChecking,
    checkForUpdates,
  };
}
