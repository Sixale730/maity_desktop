'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { isAuxWindowPath } from '@/lib/auxWindows';
import { healthHeartbeatService } from '@/services/healthHeartbeatService';

/**
 * Arranca el heartbeat de salud (`health.heartbeat` → maity.platform_logs).
 *
 * Solo en la ventana principal: las auxiliares (coach-float, recording-widget,
 * device-picker) reportarían el mismo dato global por triplicado. Se monta
 * dentro de AuthGate junto a CloudSyncInitializer; el gate fino de sesión lo
 * hace el propio servicio en cada tick. El efecto depende de `isAux` (booleano
 * estable), NO de `pathname`: navegar entre rutas normales no reinicia el
 * heartbeat.
 */
export function HealthHeartbeatInitializer() {
  const pathname = usePathname();
  const isAux = isAuxWindowPath(pathname);

  useEffect(() => {
    if (isAux) return;
    void healthHeartbeatService.start();
    return () => healthHeartbeatService.stop();
  }, [isAux]);

  return null;
}
