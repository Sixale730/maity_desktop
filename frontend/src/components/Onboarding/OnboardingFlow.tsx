import React, { useEffect } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import {
  WelcomeStep,
  PermissionsStep,
  ModelDownloadStep,
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

  // 3-Step Onboarding Flow:
  // Step 1: Welcome - Introduce Maity features
  // Step 2: Permissions - Request mic + system audio (macOS only; Windows skips to step 3)
  // Step 3: Model Download - Download Gemma 3 1B (tips) + 4B (analysis)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <PermissionsStep />}
      {currentStep === 3 && <ModelDownloadStep />}
    </div>
  );
}
