'use client';

import { useEffect } from 'react';

import { initErrorTelemetry } from '@/lib/errorTelemetry';

/**
 * Instala los handlers globales de error (`app.error` → maity.platform_logs).
 *
 * Va FUERA de ErrorBoundary y AuthGate (invariante validada en layout.test.ts):
 * debe capturar errores pre-auth y seguir vivo si el boundary desmonta el
 * árbol — por eso el init es idempotente y sin teardown.
 *
 * Ventanas auxiliares: NUNCA montan este componente — RootLayout hace early
 * return para las rutas de `lib/auxWindows.ts` antes de llegar a esta rama, así
 * que hoy solo la ventana principal reporta. Si eso cambiara, ojo con el puente
 * rust-error: su `emit()` es broadcast a todas las webviews y cada listener
 * duplicaría el reporte (la barrera real es el dedup del lado Rust).
 */
export function ErrorTelemetryInitializer() {
  useEffect(() => {
    initErrorTelemetry();
  }, []);

  return null;
}
