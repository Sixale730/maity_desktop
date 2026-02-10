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

  // 2-Step Onboarding Flow:
  // Step 1: Welcome - Introduce Maity features (Windows completes here)
  // Step 2: Permissions - Request mic + system audio (macOS only)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <PermissionsStep />}
    </div>
  );
}
