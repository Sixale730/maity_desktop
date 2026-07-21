/**
 * useOnboardingFlow Hook
 * Manages the multi-step onboarding flow state (Company -> Avatar -> Questionnaire)
 */

import { useState, useCallback } from 'react';

export type OnboardingStep = 0 | 1 | 2 | 3; // 0=company code, 1=avatar, 2=instructions, 3=questionnaire

interface OnboardingState {
  currentStep: OnboardingStep;
  companyStepCompleted: boolean;
  avatarCompleted: boolean;
}

interface UseOnboardingFlowProps {
  userId: string;
  preview?: boolean;
  /** Users that already belong to a company skip the company-code step */
  hasCompany?: boolean;
}

interface UseOnboardingFlowReturn {
  currentStep: OnboardingStep;
  companyStepCompleted: boolean;
  avatarCompleted: boolean;
  goToStep: (step: OnboardingStep) => void;
  completeCompanyStep: () => void;
  completeAvatarStep: () => void;
  startQuestionnaire: () => void;
  clearProgress: () => void;
}

// v2: step numbering changed when the company-code step was added (old 0=avatar)
const STORAGE_KEY = (userId: string) => `onboarding_state_v2_${userId}`;

const defaultState = (hasCompany: boolean): OnboardingState => ({
  currentStep: hasCompany ? 1 : 0,
  companyStepCompleted: hasCompany,
  avatarCompleted: false,
});

export function useOnboardingFlow({ userId, preview, hasCompany = false }: UseOnboardingFlowProps): UseOnboardingFlowReturn {
  // Synchronous lazy initializer — reads localStorage on first render
  // to avoid the flash/race condition with AnimatePresence mode="wait"
  const [state, setState] = useState<OnboardingState>(() => {
    if (!userId || preview) return defaultState(hasCompany);
    try {
      const saved = localStorage.getItem(STORAGE_KEY(userId));
      if (saved) {
        const parsed = JSON.parse(saved) as OnboardingState;
        if ([0, 1, 2, 3].includes(parsed.currentStep)) {
          // User joined a company since last visit: the code step no longer applies
          if (hasCompany && parsed.currentStep === 0) {
            return { ...parsed, currentStep: 1, companyStepCompleted: true };
          }
          console.log('[useOnboardingFlow] Loaded saved state:', parsed);
          return parsed;
        }
      }
    } catch (error) {
      console.error('[useOnboardingFlow] Error loading saved state:', error);
    }
    return defaultState(hasCompany);
  });

  // Save state changes (skip in preview mode)
  const saveState = useCallback(
    (newState: OnboardingState) => {
      if (!userId || preview) return;

      try {
        localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(newState));
        console.log('[useOnboardingFlow] Saved state:', newState);
      } catch (error) {
        console.error('[useOnboardingFlow] Error saving state:', error);
      }
    },
    [userId, preview]
  );

  // Navigate to a specific step
  const goToStep = useCallback(
    (step: OnboardingStep) => {
      const newState = { ...state, currentStep: step };
      setState(newState);
      saveState(newState);
    },
    [state, saveState]
  );

  // Mark company-code step as done (redeemed or skipped) and advance to avatar
  const completeCompanyStep = useCallback(() => {
    const newState: OnboardingState = {
      ...state,
      currentStep: 1,
      companyStepCompleted: true,
    };
    setState(newState);
    saveState(newState);
    console.log('[useOnboardingFlow] Company step completed');
  }, [state, saveState]);

  // Mark avatar step as completed and advance to instructions
  const completeAvatarStep = useCallback(() => {
    const newState: OnboardingState = {
      ...state,
      currentStep: 2,
      avatarCompleted: true,
    };
    setState(newState);
    saveState(newState);
    console.log('[useOnboardingFlow] Avatar step completed');
  }, [state, saveState]);

  // Start the questionnaire (move from instructions to form)
  const startQuestionnaire = useCallback(() => {
    const newState: OnboardingState = {
      ...state,
      currentStep: 3,
    };
    setState(newState);
    saveState(newState);
    console.log('[useOnboardingFlow] Starting questionnaire');
  }, [state, saveState]);

  // Clear all progress (call on successful completion)
  const clearProgress = useCallback(() => {
    if (!userId) return;

    try {
      localStorage.removeItem(STORAGE_KEY(userId));
      console.log('[useOnboardingFlow] Cleared progress');
    } catch (error) {
      console.error('[useOnboardingFlow] Error clearing progress:', error);
    }
  }, [userId]);

  return {
    currentStep: state.currentStep,
    companyStepCompleted: state.companyStepCompleted,
    avatarCompleted: state.avatarCompleted,
    goToStep,
    completeCompanyStep,
    completeAvatarStep,
    startQuestionnaire,
    clearProgress,
  };
}
