'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { isAuxWindowPath } from '@/lib/auxWindows';

/**
 * Arranca las descargas de modelos en background cuando el onboarding YA está
 * completado (cuenta existente) y algún modelo falta — sin mostrar ninguna
 * pantalla de consentimiento (el usuario ya consintió en su onboarding original).
 *
 * Reemplaza al antiguo `ModelDownloadGate`: para cuentas nuevas, `WelcomeStep`
 * ("Bienvenido a Maity") ya llama `startBackgroundDownloads` en su botón; aquí es
 * idempotente (los guards internos saltan lo presente / en curso) y actúa como red
 * de seguridad para cuentas existentes a las que les falte el modelo (reinstalación
 * en máquina nueva, modelo borrado, etc.). El progreso se ve en el
 * `OnboardingDownloadWidget` flotante; nunca bloquea.
 *
 * Debe montarse DENTRO de `OnboardingProvider` (usa `useOnboarding`).
 */
export function BackgroundDownloadStarter() {
  const pathname = usePathname();
  const {
    completed,
    parakeetDownloaded,
    summaryModelReady,
    startBackgroundDownloads,
  } = useOnboarding();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    // No arrancar en ventanas auxiliares (coach flotante, widget de grabación, picker)
    if (isAuxWindowPath(pathname)) {
      return;
    }
    // Solo cuando el onboarding ya está completo (cuenta existente o recién terminada)
    if (!completed) return;
    // Si ya no falta nada que descargar, no hay nada que arrancar.
    //
    // OJO: la condición mira `summaryModelReady`, no `summaryModelDownloaded`.
    // En tier Low el modelo de resumen no se descarga nunca, así que
    // `summaryModelDownloaded` se queda en `false` PARA SIEMPRE: con él, este
    // efecto llamaría a `startBackgroundDownloads` en cada arranque de la app y,
    // como ésa función pone `isBackgroundDownloading = true` nada más entrar,
    // el widget de descargas aparecería sin nada que descargar.
    if (parakeetDownloaded && summaryModelReady) return;

    startedRef.current = true;
    // startBackgroundDownloads tiene guards internos (has_models / is_model_ready /
    // already-downloading), así que llamarlo es seguro aunque un modelo ya exista.
    void startBackgroundDownloads(true);
  }, [completed, parakeetDownloaded, summaryModelReady, pathname, startBackgroundDownloads]);

  return null;
}
