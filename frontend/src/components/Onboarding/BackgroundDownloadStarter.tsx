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
    summaryModelDownloaded,
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
    // Si ambos modelos ya están en disco, no hay nada que arrancar
    if (parakeetDownloaded && summaryModelDownloaded) return;

    startedRef.current = true;
    // startBackgroundDownloads tiene guards internos (has_models / is_model_ready /
    // already-downloading), así que llamarlo es seguro aunque un modelo ya exista.
    void startBackgroundDownloads(true);
  }, [completed, parakeetDownloaded, summaryModelDownloaded, pathname, startBackgroundDownloads]);

  return null;
}
