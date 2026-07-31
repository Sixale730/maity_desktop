'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { cloudSyncWorker } from '@/services/cloudSyncWorker';
import { isAuxWindowPath } from '@/lib/auxWindows';
import { logger } from '@/lib/logger';

/**
 * Starts/stops the cloud sync worker based on auth state.
 * Also nudges the worker when the browser comes back online.
 *
 * Gate de ventana auxiliar: defensa en profundidad — hoy las rutas aux ni
 * siquiera montan esta rama del layout (early return en RootLayout), pero si
 * eso cambiara, N ventanas levantarían N sync workers en paralelo (polling de
 * 5s + SELECTs a Supabase cada 60s, cada uno). Mismo patrón que
 * HealthHeartbeatInitializer: el efecto depende del booleano `isAux`, no de
 * `pathname`, para no reiniciar el worker en cada navegación.
 */
export function CloudSyncInitializer() {
  // IMPORTANT: maityUser.id is the FK on omi_conversations.user_id and 36 other
  // tables in maity.* schema. Never use user.id (Supabase auth) for queries
  // against maity tables. See feedback_user_vs_maityUser.md.
  const { isAuthenticated, maityUser } = useAuth();
  const pathname = usePathname();
  const isAux = isAuxWindowPath(pathname);

  const userId = maityUser?.id ?? null;

  useEffect(() => {
    if (isAux) return;
    if (isAuthenticated && userId) {
      cloudSyncWorker.start(userId);
    } else {
      cloudSyncWorker.stop();
    }

    return () => {
      cloudSyncWorker.stop();
    };
  }, [isAux, isAuthenticated, userId]);

  useEffect(() => {
    if (isAux) return;
    const handleOnline = () => {
      logger.debug('[CloudSyncInitializer] Network online, nudging sync worker');
      cloudSyncWorker.nudge();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [isAux]);

  return null;
}
