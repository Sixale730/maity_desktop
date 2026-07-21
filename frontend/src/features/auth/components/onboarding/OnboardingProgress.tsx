/**
 * OnboardingProgress Component
 * Visual progress indicator showing the main onboarding phases
 */

import { cn } from '@maity/shared';
import { Building2, User, ClipboardList, Check } from 'lucide-react';
import type { OnboardingStep } from '../../hooks/useOnboardingFlow';

interface OnboardingProgressProps {
  currentStep: OnboardingStep;
  companyStepCompleted: boolean;
  avatarCompleted: boolean;
  /** Whether the company-code phase is part of this user's flow */
  showCompanyStep: boolean;
  className?: string;
}

interface Phase {
  label: string;
  icon: typeof User;
  isComplete: (props: OnboardingProgressProps) => boolean;
  isCurrent: (props: OnboardingProgressProps) => boolean;
}

const COMPANY_PHASE: Phase = {
  label: 'Tu Empresa',
  icon: Building2,
  isComplete: ({ companyStepCompleted }) => companyStepCompleted,
  isCurrent: ({ currentStep }) => currentStep === 0,
};

const AVATAR_PHASE: Phase = {
  label: 'Tu Avatar',
  icon: User,
  isComplete: ({ avatarCompleted }) => avatarCompleted,
  isCurrent: ({ currentStep }) => currentStep === 1,
};

// Instructions and questionnaire are combined as the "Cuestionario" phase
const QUESTIONNAIRE_PHASE: Phase = {
  label: 'Cuestionario',
  icon: ClipboardList,
  isComplete: () => false, // completion is handled outside (form submit navigates away)
  isCurrent: ({ currentStep }) => currentStep === 2 || currentStep === 3,
};

export function OnboardingProgress(props: OnboardingProgressProps) {
  const { showCompanyStep, className } = props;

  const phases = showCompanyStep
    ? [COMPANY_PHASE, AVATAR_PHASE, QUESTIONNAIRE_PHASE]
    : [AVATAR_PHASE, QUESTIONNAIRE_PHASE];

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-center gap-4">
        {phases.map((phase, index) => {
          const isComplete = phase.isComplete(props);
          const isCurrent = phase.isCurrent(props);
          const Icon = phase.icon;

          return (
            <div key={phase.label} className="flex items-center">
              {/* Step indicator */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300',
                    isComplete
                      ? 'bg-green-500 text-white'
                      : isCurrent
                        ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2'
                        : 'bg-muted text-muted-foreground'
                  )}
                >
                  {isComplete ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-sm font-medium transition-colors',
                    isCurrent ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  {phase.label}
                </span>
              </div>

              {/* Connector line (not after last item) */}
              {index < phases.length - 1 && (
                <div
                  className={cn(
                    'w-16 h-0.5 mx-4 transition-colors',
                    isComplete ? 'bg-green-500' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
