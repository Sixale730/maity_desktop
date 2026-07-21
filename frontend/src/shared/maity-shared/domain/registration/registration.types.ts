/**
 * Types for native registration form
 * 17 steps total: 3 personal (q1+q2 merged) + 12 Likert + 1 choice + 1 consent
 */

/**
 * Likert scale value (1-5)
 */
export type LikertValue = 1 | 2 | 3 | 4 | 5;

/**
 * Competency areas with their associated colors
 */
export enum CompetencyArea {
  CLARIDAD = 'claridad',
  ADAPTACION = 'adaptacion',
  PERSUASION = 'persuasion',
  ESTRUCTURA = 'estructura',
  PROPOSITO = 'proposito',
  EMPATIA = 'empatia',
}

/**
 * Color mapping for each competency area
 */
export const CompetencyColors: Record<CompetencyArea, string> = {
  [CompetencyArea.CLARIDAD]: 'hsl(var(--maity-blue))', // Blue 🟦
  [CompetencyArea.ADAPTACION]: 'hsl(var(--accent))', // Green 🟩
  [CompetencyArea.PERSUASION]: '#9b4dca', // Purple 🟪
  [CompetencyArea.ESTRUCTURA]: '#ff8c42', // Orange 🟧
  [CompetencyArea.PROPOSITO]: '#ffd93d', // Yellow 🟨
  [CompetencyArea.EMPATIA]: '#ef4444', // Red ❤️
};

/**
 * Likert question definition
 */
export interface LikertQuestion {
  id: string; // q5, q6, ... q16
  area: CompetencyArea;
  text: string;
  order: number;
}

/**
 * All 12 Likert questions
 */
export const LikertQuestions: LikertQuestion[] = [
  // CLARIDAD (🟦)
  {
    id: 'q5',
    area: CompetencyArea.CLARIDAD,
    text: 'Expreso mis ideas de manera simple y clara.',
    order: 1,
  },
  {
    id: 'q6',
    area: CompetencyArea.CLARIDAD,
    text: 'Evito rodeos y voy directo al punto cuando explico algo.',
    order: 2,
  },
  // ADAPTACIÓN (🟩)
  {
    id: 'q7',
    area: CompetencyArea.ADAPTACION,
    text: 'Adapto mi lenguaje con la persona con la que hablo.',
    order: 3,
  },
  {
    id: 'q8',
    area: CompetencyArea.ADAPTACION,
    text: 'Identifico señales (tono, palabras, estilo) y ajusto mi comunicación para crear conexión.',
    order: 4,
  },
  // PERSUASIÓN (🟪)
  {
    id: 'q9',
    area: CompetencyArea.PERSUASION,
    text: 'Uso ejemplos, historias o datos para reforzar mis ideas.',
    order: 5,
  },
  {
    id: 'q10',
    area: CompetencyArea.PERSUASION,
    text: 'Cuando presento una idea, explico el beneficio o impacto que tiene para la otra persona.',
    order: 6,
  },
  // ESTRUCTURA (🟧)
  {
    id: 'q11',
    area: CompetencyArea.ESTRUCTURA,
    text: 'Organizo mis mensajes con inicio, desarrollo y un cierre claro.',
    order: 7,
  },
  {
    id: 'q12',
    area: CompetencyArea.ESTRUCTURA,
    text: 'Antes de hablar o escribir, pienso en el orden de lo que voy a decir.',
    order: 8,
  },
  // PROPÓSITO (🟨)
  {
    id: 'q13',
    area: CompetencyArea.PROPOSITO,
    text: 'Incluyo un propósito u objetivo claro en mis mensajes.',
    order: 9,
  },
  {
    id: 'q14',
    area: CompetencyArea.PROPOSITO,
    text: 'Cuando comunico algo, dejo claro qué se espera después (acción, acuerdo o siguiente paso).',
    order: 10,
  },
  // EMPATÍA (❤️)
  {
    id: 'q15',
    area: CompetencyArea.EMPATIA,
    text: 'Escucho con atención y confirmo que entendí lo que me quisieron decir.',
    order: 11,
  },
  {
    id: 'q16',
    area: CompetencyArea.EMPATIA,
    text: 'Hago preguntas para entender mejor en lugar de asumir.',
    order: 12,
  },
];

/**
 * Open-ended question definition (legacy, kept for compatibility)
 */
export interface OpenQuestion {
  id: string;
  text: string;
  placeholder: string;
  order: number;
}

/**
 * @deprecated q18 and q19 removed. q17 is now a choice question.
 */
export const OpenQuestions: OpenQuestion[] = [];

/**
 * Choice question definition (single-select)
 */
export interface ChoiceQuestion {
  id: string;
  text: string;
  options: string[];
  order: number;
}

/**
 * Choice questions (q17)
 */
export const ChoiceQuestions: ChoiceQuestion[] = [
  {
    id: 'q17',
    text: '¿Cuál consideras que es la principal barrera que enfrentas al comunicarte?',
    options: [
      'Nervios o ansiedad al hablar',
      'Dificultad para organizar mis ideas',
      'Falta de confianza en mi mensaje',
    ],
    order: 13,
  },
];

/**
 * Consent question definition
 */
export interface ConsentQuestion {
  id: string; // q20
  text: string;
  order: number;
}

/**
 * Consent question (final step)
 */
export const ConsentQuestion: ConsentQuestion = {
  id: 'q20',
  text: 'Acepto el uso de mis respuestas con fines de desarrollo personal. No se compartirán sin mi permiso.',
  order: 16,
};

/**
 * Personal info questions
 */
export interface PersonalInfoQuestion {
  id: string; // q1, q2, q3, q4
  label: string;
  placeholder: string;
  type: 'text' | 'tel';
  order: number;
}

/**
 * All 4 personal info questions (q1=nombre, q2=apellido, q3=phone, q4=position)
 */
export const PersonalInfoQuestions: PersonalInfoQuestion[] = [
  {
    id: 'q1',
    label: 'Nombre(s)',
    placeholder: 'Ingresa tu nombre',
    type: 'text',
    order: 1,
  },
  {
    id: 'q2',
    label: 'Apellidos',
    placeholder: 'Ingresa tus apellidos',
    type: 'text',
    order: 2,
  },
  {
    id: 'q3',
    label: 'Teléfono',
    placeholder: '+52 123 456 7890',
    type: 'tel',
    order: 3,
  },
  {
    id: 'q4',
    label: 'Puesto',
    placeholder: 'Gerente de Ventas, CEO, etc.',
    type: 'text',
    order: 4,
  },
];

/**
 * Complete registration form data
 */
export interface RegistrationFormData {
  // Personal info (q1-q4)
  q1: string; // Nombre
  q2: string; // Apellido
  q3: string; // Teléfono
  q4: string; // Puesto

  // Likert questions (q5-q16)
  q5: LikertValue; // CLARIDAD
  q6: LikertValue; // CLARIDAD
  q7: LikertValue; // ADAPTACIÓN
  q8: LikertValue; // ADAPTACIÓN
  q9: LikertValue; // PERSUASIÓN
  q10: LikertValue; // PERSUASIÓN
  q11: LikertValue; // ESTRUCTURA
  q12: LikertValue; // ESTRUCTURA
  q13: LikertValue; // PROPÓSITO
  q14: LikertValue; // PROPÓSITO
  q15: LikertValue; // EMPATÍA
  q16: LikertValue; // EMPATÍA

  // Choice question (q17)
  q17: string; // Barrera de comunicación (selección)

  // Legacy open-ended (removed, optional for backwards compat)
  q18?: string;
  q19?: string;

  // Consent (q20)
  q20: boolean; // Consentimiento
}

/**
 * Form response from database
 */
export interface FormResponse extends RegistrationFormData {
  id: string;
  user_id: string;
  submitted_at: string;
  raw?: Record<string, unknown>;
}

/**
 * Form submission payload
 */
export interface RegistrationFormSubmission {
  formData: RegistrationFormData;
  userId: string;
}

/**
 * Form step type
 */
export type FormStepType = 'personal' | 'likert' | 'open' | 'choice' | 'consent';

/**
 * Form step definition
 */
export interface FormStep {
  index: number; // 0-19
  type: FormStepType;
  questionId: string;
  title?: string;
  subtitle?: string;
}

const TOTAL_FORM_STEPS = 17;

/**
 * Generate all form steps (17 total)
 * q1+q2 merged into step 0, q18/q19 removed, q17 is now choice
 */
export const getAllFormSteps = (): FormStep[] => {
  const steps: FormStep[] = [];
  let stepIndex = 0;

  // Personal info steps (0-2): q1+q2 merged, q3, q4
  // Step 0: q1 (renders q1+q2 together)
  steps.push({
    index: stepIndex++,
    type: 'personal',
    questionId: 'q1',
    title: 'Información Personal',
    subtitle: `Pregunta 1 de ${TOTAL_FORM_STEPS}`,
  });
  // Step 1: q3 (phone)
  steps.push({
    index: stepIndex++,
    type: 'personal',
    questionId: 'q3',
    title: 'Información Personal',
    subtitle: `Pregunta 2 de ${TOTAL_FORM_STEPS}`,
  });
  // Step 2: q4 (position)
  steps.push({
    index: stepIndex++,
    type: 'personal',
    questionId: 'q4',
    title: 'Información Personal',
    subtitle: `Pregunta 3 de ${TOTAL_FORM_STEPS}`,
  });

  // Likert steps (3-14)
  LikertQuestions.forEach((q) => {
    steps.push({
      index: stepIndex,
      type: 'likert',
      questionId: q.id,
      title: `Evaluación: ${q.area.toUpperCase()}`,
      subtitle: `Pregunta ${stepIndex + 1} de ${TOTAL_FORM_STEPS}`,
    });
    stepIndex++;
  });

  // Choice step (15): q17
  ChoiceQuestions.forEach((q) => {
    steps.push({
      index: stepIndex,
      type: 'choice',
      questionId: q.id,
      title: 'Pregunta de Selección',
      subtitle: `Pregunta ${stepIndex + 1} de ${TOTAL_FORM_STEPS}`,
    });
    stepIndex++;
  });

  // Consent step (16)
  steps.push({
    index: stepIndex,
    type: 'consent',
    questionId: ConsentQuestion.id,
    title: 'Consentimiento',
    subtitle: `Pregunta ${stepIndex + 1} de ${TOTAL_FORM_STEPS}`,
  });

  return steps;
};

/**
 * Form progress state
 */
export interface FormProgress {
  currentStep: number; // 0-19
  answers: Partial<RegistrationFormData>;
  isComplete: boolean;
}

/**
 * Likert-only data for admin testing (q5-q16)
 * Used for testing self-assessment without requiring full registration
 */
export interface LikertOnlyData {
  q5: LikertValue; // CLARIDAD
  q6: LikertValue; // CLARIDAD
  q7: LikertValue; // ADAPTACIÓN
  q8: LikertValue; // ADAPTACIÓN
  q9: LikertValue; // PERSUASIÓN
  q10: LikertValue; // PERSUASIÓN
  q11: LikertValue; // ESTRUCTURA
  q12: LikertValue; // ESTRUCTURA
  q13: LikertValue; // PROPÓSITO
  q14: LikertValue; // PROPÓSITO
  q15: LikertValue; // EMPATÍA
  q16: LikertValue; // EMPATÍA
}
