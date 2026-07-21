/**
 * OnboardingFlow Component
 * Main orchestrator for the multi-step onboarding flow
 * Flow: Company code (only if user has no company) -> Avatar -> Instructions -> Questionnaire
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingFlow } from '../../hooks/useOnboardingFlow';
import { OnboardingProgress } from './OnboardingProgress';
import { OnboardingCompanyStep } from './OnboardingCompanyStep';
import { OnboardingAvatarStep } from './OnboardingAvatarStep';
import { RegistrationInstructions } from '../registration/RegistrationInstructions';
import { NativeRegistrationForm } from '../registration/NativeRegistrationForm';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
  preview?: boolean;
  /** Users that already belong to a company skip the company-code step */
  hasCompany?: boolean;
}

export function OnboardingFlow({ userId, onComplete, preview, hasCompany = false }: OnboardingFlowProps) {
  const {
    currentStep,
    companyStepCompleted,
    avatarCompleted,
    completeCompanyStep,
    completeAvatarStep,
    startQuestionnaire,
    clearProgress,
    goToStep,
  } = useOnboardingFlow({ userId, preview, hasCompany });

  // Handle company-code step completion (redeemed or skipped)
  const handleCompanyComplete = () => {
    completeCompanyStep();
  };

  // Handle avatar step completion
  const handleAvatarComplete = () => {
    completeAvatarStep();
  };

  // Handle instructions start (move to questionnaire)
  const handleInstructionsStart = () => {
    startQuestionnaire();
  };

  // Handle questionnaire completion
  const handleQuestionnaireComplete = () => {
    if (!preview) {
      clearProgress();
    }
    onComplete();
  };

  return (
    <div className="w-full space-y-6">
      {/* Progress Indicator */}
      <OnboardingProgress
        currentStep={currentStep}
        companyStepCompleted={companyStepCompleted}
        avatarCompleted={avatarCompleted}
        showCompanyStep={!hasCompany}
        className="mb-8"
      />

      {/* Step Content */}
      <AnimatePresence mode="wait">
        {currentStep === 0 && (
          <motion.div
            key="company-step"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <OnboardingCompanyStep
              onComplete={handleCompanyComplete}
              preview={preview}
            />
          </motion.div>
        )}

        {currentStep === 1 && (
          <motion.div
            key="avatar-step"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <OnboardingAvatarStep
              userId={userId}
              onComplete={handleAvatarComplete}
              preview={preview}
            />
          </motion.div>
        )}

        {currentStep === 2 && (
          <motion.div
            key="instructions-step"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <RegistrationInstructions
              onStart={handleInstructionsStart}
              onBack={() => goToStep(1)}
            />
          </motion.div>
        )}

        {currentStep === 3 && (
          <motion.div
            key="questionnaire-step"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <NativeRegistrationForm
              userId={userId}
              onComplete={handleQuestionnaireComplete}
              preview={preview}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
