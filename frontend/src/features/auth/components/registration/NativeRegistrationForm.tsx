import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Alert, AlertDescription } from '@/ui/components/ui/alert';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { ArrowLeft, ArrowRight, Loader2, AlertCircle, Eye } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { LikertScale } from './LikertScale';
import { ProgressIndicator } from './ProgressIndicator';
import { PhoneInput } from './PhoneInput';
import { useRegistrationForm } from '../../hooks/useRegistrationForm';
import {
  PersonalInfoQuestions,
  LikertQuestions,
  ChoiceQuestions,
  ConsentQuestion,
  LikertValue,
  CompetencyArea,
} from '@maity/shared';

interface NativeRegistrationFormProps {
  userId: string;
  onComplete: () => void;
  preview?: boolean;
}

export function NativeRegistrationForm({
  userId,
  onComplete,
  preview,
}: NativeRegistrationFormProps) {
  const { t } = useLanguage();
  const {
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
  } = useRegistrationForm({ userId, onComplete });

  const { questionId, type } = currentStepInfo;

  // Render Personal Info Question
  const renderPersonalInfo = () => {
    const isMergedNameStep = questionId === 'q1';
    const isPhoneQuestion = questionId === 'q3';

    if (isMergedNameStep) {
      // Merged q1 (Nombre) + q2 (Apellido) in one step
      const q1 = PersonalInfoQuestions.find((q) => q.id === 'q1')!;
      const q2 = PersonalInfoQuestions.find((q) => q.id === 'q2')!;
      const valueQ1 = (formData.q1 as string) || '';
      const valueQ2 = (formData.q2 as string) || '';

      return (
        <motion.div
          key="q1-q2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className="space-y-4">
            <div className="space-y-3">
              <Label htmlFor="q1" className="text-lg font-medium">
                {q1.label}
              </Label>
              <Input
                id="q1"
                type="text"
                placeholder={q1.placeholder}
                value={valueQ1}
                onChange={(e) => setAnswer('q1', e.target.value)}
                className="text-base h-12"
                autoFocus
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="q2" className="text-lg font-medium">
                {q2.label}
              </Label>
              <Input
                id="q2"
                type="text"
                placeholder={q2.placeholder}
                value={valueQ2}
                onChange={(e) => setAnswer('q2', e.target.value)}
                className="text-base h-12"
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            {!isFirstStep && (
              <Button
                type="button"
                variant="outline"
                onClick={goToPreviousStep}
                disabled={isSubmitting}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Atrás
              </Button>
            )}
            <Button
              type="button"
              onClick={goToNextStep}
              disabled={!canGoNext || isSubmitting}
            >
              Siguiente
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </motion.div>
      );
    }

    const question = PersonalInfoQuestions.find((q) => q.id === questionId);
    if (!question) return null;

    const value = (formData[questionId as keyof typeof formData] as string) || '';

    return (
      <motion.div
        key={questionId}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {isPhoneQuestion ? (
          <PhoneInput
            id={questionId}
            label={question.label}
            placeholder="10 dígitos"
            value={value}
            onChange={(val) => setAnswer(questionId, val)}
            error={
              value && !canGoNext
                ? 'Ingresa un número de teléfono válido (10 dígitos)'
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            <Label htmlFor={questionId} className="text-lg font-medium">
              {question.label}
            </Label>
            <Input
              id={questionId}
              type={question.type}
              placeholder={question.placeholder}
              value={value}
              onChange={(e) => setAnswer(questionId, e.target.value)}
              className="text-base h-12"
              autoFocus
            />
          </div>
        )}

        <div className="flex gap-3 justify-end">
          {!isFirstStep && (
            <Button
              type="button"
              variant="outline"
              onClick={goToPreviousStep}
              disabled={isSubmitting}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Atrás
            </Button>
          )}
          <Button
            type="button"
            onClick={goToNextStep}
            disabled={!canGoNext || isSubmitting}
          >
            Siguiente
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </motion.div>
    );
  };

  // Render Likert Question
  const renderLikertQuestion = () => {
    const question = LikertQuestions.find((q) => q.id === questionId);
    if (!question) return null;

    const value = formData[questionId as keyof typeof formData] as
      | LikertValue
      | undefined;

    return (
      <motion.div
        key={questionId}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-8"
      >
        {/* Area Badge */}
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-full text-sm font-medium text-white"
            style={{
              backgroundColor:
                question.area === CompetencyArea.CLARIDAD
                  ? 'hsl(var(--maity-blue))'
                  : question.area === CompetencyArea.ADAPTACION
                  ? 'hsl(var(--accent))'
                  : question.area === CompetencyArea.PERSUASION
                  ? '#9b4dca'
                  : question.area === CompetencyArea.ESTRUCTURA
                  ? '#ff8c42'
                  : question.area === CompetencyArea.PROPOSITO
                  ? '#ffd93d'
                  : '#8b4513',
            }}
          >
            {question.area.toUpperCase()}
          </span>
        </div>

        {/* Question Text */}
        <div>
          <h3 className="text-xl sm:text-2xl font-medium text-foreground">
            {question.text}
          </h3>
        </div>

        {/* Likert Scale */}
        <LikertScale
          value={value}
          onChange={(val) => setAnswer(questionId, val)}
          area={question.area}
          autoAdvance={true}
          autoAdvanceDelay={500}
        />

        {/* Back Button (only for manual control) */}
        {!isFirstStep && (
          <div className="flex justify-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={goToPreviousStep}
              disabled={isSubmitting}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Atrás
            </Button>
          </div>
        )}
      </motion.div>
    );
  };

  // Render Choice Question (single-select cards)
  const renderChoiceQuestion = () => {
    const question = ChoiceQuestions.find((q) => q.id === questionId);
    if (!question) return null;

    const value = (formData[questionId as keyof typeof formData] as string) || '';

    return (
      <motion.div
        key={questionId}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        <Label className="text-lg font-medium">{question.text}</Label>

        <div className="space-y-3">
          {question.options.map((option) => {
            const isSelected = value === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setAnswer(questionId, option)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background hover:border-primary/50 text-foreground'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'border-primary' : 'border-muted-foreground'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="text-base">{option}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            disabled={isSubmitting}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Atrás
          </Button>
          <Button
            type="button"
            onClick={goToNextStep}
            disabled={!canGoNext || isSubmitting}
          >
            Siguiente
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </motion.div>
    );
  };

  // Scrollable privacy policy state
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const privacyScrollRef = useRef<HTMLDivElement>(null);

  const handlePrivacyScroll = useCallback(() => {
    const el = privacyScrollRef.current;
    if (!el) return;
    const threshold = 20;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // Render Consent Question
  const renderConsentQuestion = () => {
    const value = formData[questionId as keyof typeof formData] as boolean;

    return (
      <motion.div
        key={questionId}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {/* Scrollable Privacy Policy */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">
            Aviso de Privacidad
          </h4>
          <div
            ref={privacyScrollRef}
            onScroll={handlePrivacyScroll}
            className="max-h-[300px] overflow-y-auto pr-2 space-y-4 text-sm text-muted-foreground leading-relaxed scrollbar-thin"
          >
            <p>
              Maity es una plataforma de desarrollo de comunicación profesional operada por Maity Inteligencia Artificial S.A.P.I. de C.V., con domicilio en Guadalajara, Jalisco, México.
            </p>
            <p>
              <strong className="text-foreground">Datos que recopilamos:</strong> (a) Datos personales de identificación: nombre, email, empresa, puesto, foto de perfil. (b) Datos de uso: interacciones con la plataforma, sesiones de práctica, resultados de evaluaciones, progreso y métricas de comunicación. (c) Datos de voz y audio: grabaciones de sesiones de práctica con IA, transcripciones generadas automáticamente.
            </p>
            <p>
              <strong className="text-foreground">Cómo procesamos tus datos:</strong> Procesamos tus datos con base en: consentimiento explícito al crear tu cuenta, ejecución del contrato de servicio e interés legítimo para mejorar la plataforma. Tus datos se utilizan exclusivamente para generar feedback personalizado, medir tu progreso, personalizar tu experiencia de aprendizaje y mejorar nuestros algoritmos de IA de forma anonimizada.
            </p>
            <p>
              <strong className="text-foreground">Datos de voz y audio:</strong> Las grabaciones de voz se procesan en tiempo real para generar feedback. Las transcripciones se almacenan asociadas a tu cuenta. Las grabaciones de audio originales se eliminan automáticamente después del procesamiento (máximo 72 horas). Nunca compartimos grabaciones de voz con terceros.
            </p>
            <p>
              <strong className="text-foreground">Transferencias internacionales:</strong> Tus datos pueden ser procesados en servidores ubicados en Estados Unidos (AWS/Supabase) y otros países. Todas las transferencias cumplen con los estándares de protección adecuados.
            </p>
            <p>
              <strong className="text-foreground">Derechos ARCO:</strong> Tienes derecho a Acceder, Rectificar, Cancelar y Oponerte al tratamiento de tus datos personales. Contacta a dpo@maity.com.mx. Tiempo de respuesta: máximo 20 días hábiles.
            </p>
            <p>
              <strong className="text-foreground">Medidas de seguridad:</strong> Cifrado AES-256 en reposo y TLS 1.3 en tránsito, control de acceso basado en roles, autenticación multifactor, monitoreo continuo y auditorías periódicas.
            </p>
            <p>
              <strong className="text-foreground">Retención de datos:</strong> Datos de cuenta se conservan mientras tu cuenta esté activa. Transcripciones: 12 meses. Datos de uso: 24 meses asociados, indefinidamente anonimizados. Al eliminar tu cuenta, todos los datos personales se eliminan en un plazo máximo de 30 días.
            </p>
            <p>
              <strong className="text-foreground">Legislación aplicable:</strong> Esta política se rige por la LFPDPPP y su reglamento. Para usuarios fuera de México, también cumplimos con RGPD y CCPA cuando sea aplicable.
            </p>
            <p>
              <strong className="text-foreground">Contacto:</strong> Email: dpo@maity.com.mx. Domicilio: Guadalajara, Jalisco, México. También puedes presentar una queja ante el INAI.
            </p>
          </div>
          {!hasScrolledToBottom && (
            <p className="text-xs text-muted-foreground/60 mt-2 text-center">
              Desplázate hasta el final para poder aceptar
            </p>
          )}
        </div>

        {/* Consent checkbox */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <Checkbox
              id={questionId}
              checked={value || false}
              onCheckedChange={(checked) => setAnswer(questionId, checked as boolean)}
              disabled={!hasScrolledToBottom && !preview}
              className="mt-1"
            />
            <Label
              htmlFor={questionId}
              className={`text-base font-medium cursor-pointer leading-relaxed ${
                hasScrolledToBottom || preview ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {ConsentQuestion.text}
            </Label>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            disabled={isSubmitting}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Atrás
          </Button>
          <Button
            type="button"
            onClick={preview ? onComplete : submitForm}
            disabled={preview ? false : (!canGoNext || isSubmitting)}
            className="min-w-[120px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : preview ? (
              <>
                <Eye className="h-4 w-4 mr-2" />
                {t('registration.finish_preview')}
              </>
            ) : (
              'Finalizar'
            )}
          </Button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-8 p-4 sm:p-6">
      {/* Progress Indicator */}
      <ProgressIndicator
        currentStep={currentStep}
        totalSteps={totalSteps}
        answeredSteps={answeredSteps}
      />

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Question Content */}
      <AnimatePresence mode="wait">
        {type === 'personal' && renderPersonalInfo()}
        {type === 'likert' && renderLikertQuestion()}
        {type === 'choice' && renderChoiceQuestion()}
        {type === 'consent' && renderConsentQuestion()}
      </AnimatePresence>
    </div>
  );
}
