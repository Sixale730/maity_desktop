import React, { useEffect } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import {
  WelcomeStep,
  PermissionsStep,
} from './steps';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { currentStep, completed } = useOnboarding();

  // When the onboarding context marks completed, notify the layout to hide onboarding
  useEffect(() => {
    if (completed) {
      onComplete();
    }
  }, [completed, onComplete]);

  // Onboarding Flow (una sola pantalla de arranque de descargas):
  // Step 1: Welcome ("Bienvenido a Maity") - logo + features; su botón "Comenzar y descargar"
  //   arranca Parakeet + Gemma en background (startBackgroundDownloads) y avanza sin bloquear.
  //   En Windows va directo al registro; en macOS pasa por permisos (paso 2) mientras descarga.
  // Step 2: Permissions - Request mic + system audio (solo macOS).
  // (La antigua pantalla "Tu IA personal"/ModelDownloadStep fue eliminada: es una sola.)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <PermissionsStep />}
    </div>
  );
}
