'use client';

import { useEffect } from 'react';

import { initErrorTelemetry } from '@/lib/errorTelemetry';

/**
 * Instala los handlers globales de error (`app.error` → maity.platform_logs).
 *
 * Va FUERA de ErrorBoundary y AuthGate (invariante validada en layout.test.ts):
 * debe capturar errores pre-auth y seguir vivo si el boundary desmonta el
 * árbol — por eso el init es idempotente y sin teardown. Sin gate de pathname:
 * cada ventana auxiliar reporta SUS propios errores (el `pathname` del payload
 * las distingue; el cap de 20 es por ventana).
 */
export function ErrorTelemetryInitializer() {
  useEffect(() => {
    initErrorTelemetry();
  }, []);

  return null;
}
