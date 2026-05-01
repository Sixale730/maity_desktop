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
      logger.info('[useUpdateCheck] Skip — wasCheckedRecently=true (force=false)');
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
    } catch (error) {
      // El service ya hace logger.error, pero dejamos rastro local del path.
      logger.warn('[useUpdateCheck] Update check threw — see updateService log');
      // Silently fail on startup checks to avoid disrupting user experience
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (checkOnMount) {
      // Delay the check slightly to avoid blocking app startup
      const timer = setTimeout(() => {
        checkForUpdates(false);
      }, 2000); // Check 2 seconds after mount

      return () => clearTimeout(timer);
    }
  }, [checkOnMount]);

  return {
    updateInfo,
    isChecking,
    checkForUpdates,
  };
}
