import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RegistrationFormData,
  getAllFormSteps,
  FormStep,
  LikertValue,
  RegistrationFormService,
} from '@maity/shared';
import { DIAL_CODES } from '../components/registration/phoneDialCodes';

interface UseRegistrationFormProps {
  userId: string;
  onComplete: () => void;
}

interface UseRegistrationFormReturn {
  currentStep: number;
  totalSteps: number;
  answeredSteps: number;
  formData: Partial<RegistrationFormData>;
  currentStepInfo: FormStep;
  isFirstStep: boolean;
  isLastStep: boolean;
  isSubmitting: boolean;
  error: string | null;
  setAnswer: (questionId: string, value: string | LikertValue | boolean) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  submitForm: () => Promise<void>;
  canGoNext: boolean;
}

export function useRegistrationForm({
  userId,
  onComplete,
}: UseRegistrationFormProps): UseRegistrationFormReturn {
  const steps = getAllFormSteps();
  const totalSteps = steps.length; // 19

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Partial<RegistrationFormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastAnsweredStepRef = useRef<number | null>(null);

  // Load saved progress on mount
  useEffect(() => {
    const savedProgress = RegistrationFormService.loadFormProgress(userId);
    if (savedProgress) {
      setFormData(savedProgress);
      console.log('[useRegistrationForm] Loaded saved progress');
    }
  }, [userId]);

  // Auto-save progress
  useEffect(() => {
    if (Object.keys(formData).length > 0) {
      RegistrationFormService.saveFormProgress(userId, formData);
    }
  }, [formData, userId]);

  const currentStepInfo = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  // Calculate how many questions have been answered
  // q2 is rendered inside q1's step, so count it separately
  const answeredSteps = steps.filter((step) => {
    const answer = formData[step.questionId as keyof RegistrationFormData];
    return answer !== undefined && answer !== null && answer !== '';
  }).length + (formData.q2 ? 1 : 0);

  // Check if current question is answered
  const isCurrentQuestionAnswered = useCallback(() => {
    const questionId = currentStepInfo.questionId;

    // q1 step renders q1+q2 together — both must be filled
    if (questionId === 'q1') {
      const q1 = formData.q1;
      const q2 = formData.q2;
      return !!q1 && q1.trim() !== '' && !!q2 && q2.trim() !== '';
    }

    // Phone validation: require exactly 10 local digits
    if (questionId === 'q3') {
      const phone = (formData.q3 as string) || '';
      if (!phone.startsWith('+')) return false;
      const withoutPlus = phone.slice(1);
      // Match known dial code (longest first to avoid ambiguity)
      const dialCode = DIAL_CODES.find((d) => withoutPlus.startsWith(d));
      const localDigits = dialCode ? withoutPlus.slice(dialCode.length) : withoutPlus;
      return localDigits.length === 10;
    }

    const answer = formData[questionId as keyof RegistrationFormData];
    // For boolean (consent), check if true. For others, check not empty
    if (typeof answer === 'boolean') {
      return answer === true;
    }
    return answer !== undefined && answer !== null && answer !== '';
  }, [currentStepInfo.questionId, formData]);

  const canGoNext = isCurrentQuestionAnswered();

  // Set answer for a question
  const setAnswer = useCallback((questionId: string, value: string | LikertValue | boolean) => {
    lastAnsweredStepRef.current = currentStep;
    setFormData((prev) => ({
      ...prev,
      [questionId]: value,
    }));
    setError(null);
  }, [currentStep]);

  // Go to next step
  const goToNextStep = useCallback(() => {
    if (!canGoNext) {
      setError('Por favor, responde la pregunta antes de continuar');
      return;
    }

    if (!isLastStep) {
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
      setError(null);
    }
  }, [canGoNext, isLastStep, totalSteps]);

  // Go to previous step
  const goToPreviousStep = useCallback(() => {
    if (!isFirstStep) {
      lastAnsweredStepRef.current = null;
      setCurrentStep((prev) => Math.max(prev - 1, 0));
      setError(null);
    }
  }, [isFirstStep]);

  // Auto-advance for Likert questions — only when the user just answered the
  // current step. Prevents bounce-back when navigating "Atrás" into an already
  // answered Likert (formData persists across steps).
  useEffect(() => {
    if (
      currentStepInfo.type === 'likert' &&
      isCurrentQuestionAnswered() &&
      lastAnsweredStepRef.current === currentStep
    ) {
      const timer = setTimeout(() => {
        if (!isLastStep) {
          goToNextStep();
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [currentStep, currentStepInfo.type, isCurrentQuestionAnswered, isLastStep, goToNextStep]);

  // Submit form
  const submitForm = useCallback(async () => {
    if (isSubmitting) return;

    // Validate all fields are filled (include q2 which is merged into q1's step)
    const requiredFields = [...steps.map((s) => s.questionId), 'q2'];
    const missingFields = requiredFields.filter(
      (field) =>
        formData[field as keyof RegistrationFormData] === undefined ||
        formData[field as keyof RegistrationFormData] === null ||
        formData[field as keyof RegistrationFormData] === ''
    );

    if (missingFields.length > 0) {
      setError(`Por favor, completa todas las preguntas antes de enviar (faltantes: ${missingFields.length})`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await RegistrationFormService.submitForm(
        userId,
        formData as RegistrationFormData
      );

      if (result.success) {
        // Clear saved progress
        RegistrationFormService.clearFormProgress(userId);
        console.log('[useRegistrationForm] ✅ Form submitted successfully');
        onComplete();
      } else {
        setError(result.error || 'Error al enviar el formulario');
        setIsSubmitting(false);
      }
    } catch (err: unknown) {
      console.error('[useRegistrationForm] ❌ Error submitting form:', err);
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado. Por favor, intenta de nuevo.');
      setIsSubmitting(false);
    }
  }, [formData, userId, onComplete, isSubmitting, steps]);

  return {
    currentStep,
    totalSteps,
    answeredSteps,
    formData,
    currentStepInfo,
    isFirstStep,
    isLastStep,
    isSubmitting,
    error,
    setAnswer,
    goToNextStep,
    goToPreviousStep,
    submitForm,
    canGoNext,
  };
}
