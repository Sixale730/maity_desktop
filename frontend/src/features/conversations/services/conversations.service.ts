import { supabase } from '@/lib/supabase';

// ─── V4 Analysis Types ──────────────────────────────────────────────

export interface SubPuntaje {
  puntaje_1_5: number;
  puntaje_0_100: number;
  que_mide?: string;
}

export interface Hallazgo {
  tipo: string;
  texto: string;
  cita?: string;
  alternativa?: string;
  por_que?: string;
}

export interface DimensionBase {
  puntaje: number;
  nivel: string;
  que_mide: string;
  tu_resultado: string;
  hallazgos?: Hallazgo[];
  datos_tecnicos?: Record<string, unknown>;
  dato_clave?: string;
}

export interface DimensionObjetivo extends DimensionBase {
  tipo_intencion?: string;
  sub_puntajes: {
    especificidad: SubPuntaje;
    accion: SubPuntaje;
    temporalidad: SubPuntaje;
    responsable: SubPuntaje;
    verificabilidad: SubPuntaje;
  };
  evidencia_positiva?: string[];
  evidencia_negativa?: string[];
}

export interface EmotionRadar {
  alegria: number;
  confianza: number;
  miedo: number;
  sorpresa: number;
  tristeza: number;
  disgusto: number;
  ira: number;
  anticipacion: number;
}

export interface SpeakerEmotion extends EmotionRadar {
  dominante: string;
  dominante_pct?: number;
  subtexto?: string;
}

export interface DimensionEmociones {
  tono_general: string;
  polaridad: number;
  subjetividad: number;
  intensidad: number;
  emocion_dominante: string;
  radar: EmotionRadar;
  por_hablante: Record<string, SpeakerEmotion>;
  lectura_emocional?: string;
}

export interface DimensionMuletillas {
  que_mide: string;
  tu_resultado: string;
  total: number;
  frecuencia: string;
  nivel: string;
  dominante: string;
  detalle: Record<string, number>;
}

export interface DimensionAdaptacion extends DimensionBase {
  brechas: {
    formalidad: number;
    complejidad: number;
    persuasion: number;
    longitud_turno: number;
    promedio: number;
  };
}

export interface Recomendacion {
  prioridad: number;
  titulo: string;
  texto_mejorado: string;
  descripcion?: string;
  texto_original?: string;
  impacto?: string;
  por_que?: string;
}

export interface MeetingInsight {
  dato: string;
  por_que: string;
  sugerencia: string;
}

export interface MeetingPatron {
  actual: string;
  evolucion: string;
  senales: string[];
  que_cambiaria: string;
}

export interface TimelineSegmento {
  tipo: string;
  pct: number;
  descripcion?: string;
}

export interface MomentoClave {
  nombre: string;
  minuto: number;
}

export interface MeetingTimeline {
  segmentos: TimelineSegmento[];
  momentos_clave: MomentoClave[];
  lectura?: string;
}

export interface MeetingMeta {
  formato: string;
  tipo: string;
  hablantes: string[];
  palabras_totales: number;
  oraciones_totales: number;
  turnos_totales: number;
  duracion_minutos: number;
  palabras_por_hablante: Record<string, number>;
  fecha: string;
}

export interface PuertaDetalleV4 {
  quien: string;
  minuto: number;
  cita: string;
  respuesta: string;
  explorada: boolean;
  alternativa?: string;
}

export interface MeetingRadiografiaV4 {
  muletillas_total: number;
  muletillas_detalle: Record<string, number>;
  muletillas_frecuencia: string;
  ratio_habla: number;
  preguntas: Record<string, number>;
  calidad_global: number;
  mejor_dimension: { nombre: string; puntaje: number };
  peor_dimension: { nombre: string; puntaje: number };
  participacion_pct: Record<string, number>;
  puertas_emocionales?: { momentos_vulnerabilidad: number; abiertas: number; exploradas: number; no_exploradas: number };
  puertas_detalle?: PuertaDetalleV4[];
}

export interface MeetingResumenV4 {
  puntuacion_global: number;
  nivel: string;
  descripcion: string;
  fortaleza: string;
  fortaleza_hint: string;
  mejorar: string;
  mejorar_hint: string;
}

export interface SpeakerProfileV4 {
  palabras: number;
  oraciones: number;
  muestra_insuficiente?: boolean;
  resumen: string;
  claridad: { puntaje: number; nivel: string };
  persuasion: { puntaje: number; nivel: string };
  formalidad: { puntaje: number; nivel: string };
  emociones: { dominante: string; polaridad: number };
  pos?: {
    sustantivos_pct: number;
    verbos_pct: number;
    adjetivos_pct: number;
    adverbios_pct: number;
    pronombres_pct: number;
  };
}

export interface AntiEmpatia {
  tipo: string;
  descripcion: string;
  penalizacion: number;
}

export interface EmpatiaProfileV4 {
  evaluable: boolean;
  puntaje: number;
  nivel: string;
  que_mide?: string;
  tu_resultado: string;
  reconocimiento_emocional?: number;
  escucha_activa?: number;
  tono_empatico?: number;
  anti_empatia?: AntiEmpatia[];
  hallazgos?: Hallazgo[];
}

export interface CalidadGlobalV4 {
  puntaje: number;
  nivel: string;
  que_mide?: string;
  tu_resultado?: string;
  formula_usada: string;
  componentes: {
    claridad: number;
    estructura: number;
    persuasion: number;
    proposito: number;
    adaptacion: number | null;
    empatia: number | null;
  };
  fortaleza: string;
  fortaleza_hint: string;
  mejorar: string;
  mejorar_hint: string;
}

export interface MeetingDimensionesV4 {
  claridad: DimensionBase;
  proposito: DimensionObjetivo;
  emociones: DimensionEmociones;
  estructura: DimensionBase;
  persuasion: DimensionBase;
  formalidad: DimensionBase;
  muletillas: DimensionMuletillas;
  adaptacion: DimensionAdaptacion;
}

export interface CommunicationFeedbackV4 {
  meta: MeetingMeta;
  resumen: MeetingResumenV4;
  radiografia: MeetingRadiografiaV4;
  insights: MeetingInsight[];
  patron: MeetingPatron;
  timeline: MeetingTimeline;
  dimensiones: MeetingDimensionesV4;
  por_hablante: Record<string, SpeakerProfileV4>;
  empatia: Record<string, EmpatiaProfileV4>;
  calidad_global: CalidadGlobalV4;
  recomendaciones: Recomendacion[];
}

// ─── Analysis Skipped Types ─────────────────────────────────────────

export interface AnalysisSkipped {
  status: 'skipped';
  reason: string;
  user_words?: number;
  min_required?: number;
}

export function isAnalysisSkipped(v4: unknown): v4 is AnalysisSkipped {
  return v4 !== null && typeof v4 === 'object' && 'status' in (v4 as Record<string, unknown>) && (v4 as Record<string, unknown>).status === 'skipped';
}

export function isFullAnalysis(v4: unknown): v4 is CommunicationFeedbackV4 {
  return v4 !== null && typeof v4 === 'object' && 'resumen' in (v4 as Record<string, unknown>);
}

// ─── Meeting Minutes Types ──────────────────────────────────────────

export interface MinutaParticipante {
  nombre: string;
  rol: string;
  presente: boolean;
}

export interface MinutaDistribucion {
  nombre: string;
  porcentaje: number;
}

export interface MinutaMeta {
  titulo: string;
  tipo_reunion: string;
  tipo_secundario: string | null;
  categoria_interlocutor: string;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  duracion_minutos: number | null;
  participantes: MinutaParticipante[];
  total_palabras: number;
  distribucion_participacion: MinutaDistribucion[];
}

export interface MinutaTema {
  id: string | number;
  titulo?: string;
  nombre?: string;
  etiqueta_cierre?: string;
  puntos_clave?: string[];
  resumen: string;
}

export interface MinutaDecision {
  id: string | number;
  descripcion: string;
  clasificacion?: 'CONFIRMADA' | 'TENTATIVA' | 'DIFERIDA';
  titulo?: string;
  decidio?: string;
  responsable?: string | null;
  cita?: string;
  cita_textual?: string;
  razonamiento?: string;
  condiciones?: string | null;
  fecha_resolucion?: string | null;
  voto?: string | null;
  estado?: string;
}

export interface MinutaAccionCompleta {
  id: string | number;
  responsable: string;
  fecha_limite: string | null;
  prioridad: string;
  estado: string;
  dependencias?: string[];
  criterio_exito?: string;
  descripcion?: string;
  accion?: string;
}

export interface MinutaSeguimientoReunion {
  fecha: string;
  hora: string;
  lugar: string;
  proposito: string;
}

export interface MinutaPreparacionItem {
  participante: string;
  preparacion: string;
}

export interface MinutaQuienLoDijo {
  nombre: string;
  rol?: string | null;
  contexto?: string;
}

export interface MinutaComponenteEfectividadV7 {
  valor: number;
  peso: number;
  justificacion: string;
}

export interface MinutaSeguimientoData {
  proxima_reunion?: string | MinutaSeguimientoReunion | null;
  evento_adicional?: string | null;
  agenda_sugerida?: string[] | null;
  agenda_preliminar?: string[] | null;
  preparacion_requerida?: MinutaPreparacionItem[] | string[];
  distribucion_minuta?: string[];
  preparacion?: string[];
  distribucion?: string[];
}

export interface MinutaAccionIncompleta {
  id: string | number;
  cita?: string;
  descripcion?: string;
  compromiso?: string;
  falta?: string[];
  que_falta?: string;
  sugerencia?: string;
  quien_lo_dijo?: string | { nombre: string; rol?: string | null; contexto?: string };
}

export interface MinutaComponenteEfectividad {
  nombre: string;
  score: number;
  justificacion: string;
  peso?: number;
}

export interface MinutaEfectividad {
  score_global: number;
  etiqueta: string;
  componentes: MinutaComponenteEfectividad[] | Record<string, { valor: number; peso: number; justificacion: string }>;
  veredicto: string;
}

export interface MinutaGraficas {
  participacion?: Array<{ nombre: string; valor: number }>;
  efectividad_componentes?: Array<{ nombre: string; valor: number }>;
  prioridad_acciones?: Array<{ nombre: string; valor: number }>;
  participacion_kpi?: { principal: { nombre: string; porcentaje: number }; interlocutores_porcentaje: number };
  efectividad_desglose?: Array<{ componente: string; valor: number; emoji: string }>;
}

export interface MeetingMinutesData {
  meta: MinutaMeta;
  temas: MinutaTema[];
  decisiones: MinutaDecision[];
  acciones: {
    lista: MinutaAccionCompleta[];
    seguimiento: MinutaSeguimientoData;
  };
  acciones_incompletas: MinutaAccionIncompleta[];
  efectividad: MinutaEfectividad;
  graficas: MinutaGraficas;
}

// ─── Conversation Types ─────────────────────────────────────────────

export interface OmiConversation {
  id: string;
  user_id: string | null;
  firebase_uid: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  title: string;
  overview: string;
  emoji: string | null;
  category: string | null;
  action_items: ActionItem[] | null;
  events: OmiEvent[] | null;
  transcript_text: string | null;
  source: string | null;
  language: string | null;
  status: string | null;
  words_count: number | null;
  duration_seconds: number | null;
  communication_feedback: CommunicationFeedback | null;
  communication_feedback_v4: CommunicationFeedbackV4 | AnalysisSkipped | null;
  meeting_minutes_data: MeetingMinutesData | null;
}

export interface ActionItem {
  description: string;
  completed?: boolean;
  assignee?: string;
  priority?: string;  // 'high' | 'medium' | 'low'
}

export interface OmiEvent {
  title: string;
  description?: string;
  start_time?: string;
  end_time?: string;
}

export interface CommunicationObservations {
  clarity?: string;
  structure?: string;
  objections?: string;
  calls_to_action?: string;
}

export interface CommunicationFeedback {
  // Scores numéricos (pueden no existir en todos los análisis)
  overall_score?: number;
  clarity?: number;
  engagement?: number;
  structure?: number;
  empatia?: number;
  vocabulario?: number;
  objetivo?: number;
  adaptacion?: number;
  // Textos
  feedback?: string;
  summary?: string;
  strengths?: string[];
  areas_to_improve?: string[];
  // Insights detallados por categoría
  observations?: CommunicationObservations;
  // Contadores y métricas detalladas
  counters?: {
    pero_count?: number;
    filler_words?: Record<string, number>;
    objection_words?: Record<string, number>;
    objections_made?: string[];
    objections_received?: string[];
  };
  radiografia?: {
    ratio_habla?: number;
    palabras_usuario?: number;
    palabras_otros?: number;
    muletillas_total?: number;
    muletillas_detectadas?: Record<string, number>;
    muletillas_frecuencia?: string;
  };
  preguntas?: {
    total_usuario?: number;
    total_otros?: number;
    preguntas_usuario?: string[];
    preguntas_otros?: string[];
  };
  temas?: {
    temas_tratados?: string[];
    acciones_usuario?: (string | { descripcion: string; tiene_fecha: boolean })[];
    temas_sin_cerrar?: (string | { tema: string; razon: string })[];
  };
  meeting_minutes?: string;
  patron?: {
    actual: string;
    evolucion: string;
    senales: string[];
    que_cambiaria: string;
  };
  insights?: Array<{
    dato: string;
    por_que: string;
    sugerencia: string;
  }>;
}

export interface OmiTranscriptSegment {
  id: string;
  conversation_id: string;
  segment_index: number;
  text: string;
  speaker: string | null;
  speaker_id: number | null;
  is_user: boolean | null;
  start_time: number;
  end_time: number;
}

export async function getOmiConversations(userId?: string): Promise<OmiConversation[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('omi_conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching omi conversations:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch only created_at dates for node calculation in gamified dashboard.
 * Much lighter than fetching full conversations.
 */
export async function getOmiConversationDates(
  userId: string,
  sinceDate: string,
): Promise<{ created_at: string }[]> {
  const { data, error } = await supabase
    .from('omi_conversations')
    .select('created_at')
    .eq('user_id', userId)
    .eq('deleted', false)
    .gte('created_at', sinceDate)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching omi conversation dates:', error);
    throw error;
  }

  return data || [];
}

export async function getOmiConversation(conversationId: string): Promise<OmiConversation | null> {
  const { data, error } = await supabase
    .from('omi_conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error) {
    console.error('Error fetching omi conversation:', error);
    throw error;
  }

  return data;
}

export async function getOmiTranscriptSegments(conversationId: string): Promise<OmiTranscriptSegment[]> {
  const { data, error } = await supabase
    .from('omi_transcript_segments')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('segment_index', { ascending: true });

  if (error) {
    console.error('Error fetching transcript segments:', error);
    throw error;
  }

  return data || [];
}

// Stats interfaces and functions
export interface OmiStats {
  totalConversations: number;
  avgOverallScore: number;
  totalDurationMinutes: number;
  dimensions: {
    claridad: number;
    proposito: number;
    emociones: number;
    estructura: number;
    persuasion: number;
    formalidad: number;
    muletillas: number;
    adaptacion: number;
  };
  scoreHistory: { date: string; score: number }[];
  recentConversations: { id: string; title: string; emoji: string | null; score: number; date: string }[];
}

const DIMENSION_KEYS_STATS = ['claridad', 'proposito', 'emociones', 'estructura', 'persuasion', 'formalidad', 'muletillas', 'adaptacion'] as const;

const EMPTY_DIMENSIONS = { claridad: 0, proposito: 0, emociones: 0, estructura: 0, persuasion: 0, formalidad: 0, muletillas: 0, adaptacion: 0 };

export async function getOmiStats(userId?: string): Promise<OmiStats | null> {
  if (!userId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase
    .from('omi_conversations')
    .select('id, created_at, duration_seconds, title, emoji, communication_feedback_v4')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching omi stats:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    return {
      totalConversations: 0, avgOverallScore: 0, totalDurationMinutes: 0,
      dimensions: { ...EMPTY_DIMENSIONS }, scoreHistory: [], recentConversations: [],
    };
  }

  const calcAvg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Filter conversations with V4 feedback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withV4 = data.filter((c: any) => c.communication_feedback_v4?.resumen?.puntuacion_global != null);

  // Overall scores
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overallScores = withV4.map((c: any) => c.communication_feedback_v4.resumen.puntuacion_global as number);

  // Dimension averages
  const dimAverages = { ...EMPTY_DIMENSIONS };
  for (const key of DIMENSION_KEYS_STATS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scores = withV4.map((c: any) => {
      const dim = c.communication_feedback_v4?.dimensiones?.[key];
      return dim?.puntaje as number | undefined;
    }).filter((s: number | undefined): s is number => s != null);
    dimAverages[key] = Math.round(calcAvg(scores));
  }

  // Total duration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalDurationSeconds = data.reduce((acc: number, c: any) => acc + (c.duration_seconds || 0), 0);

  // Score history (last 10 with V4 scores)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoreHistory = withV4.slice(-10).map((c: any) => ({
    date: new Date(c.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
    score: c.communication_feedback_v4.resumen.puntuacion_global as number,
  }));

  // Recent conversations (last 5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentConversations = [...data].reverse().slice(0, 5).map((c: any) => ({
    id: c.id as string,
    title: (c.title || 'Sin título') as string,
    emoji: c.emoji as string | null,
    score: (c.communication_feedback_v4?.resumen?.puntuacion_global ?? 0) as number,
    date: new Date(c.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
  }));

  return {
    totalConversations: data.length,
    avgOverallScore: Math.round(calcAvg(overallScores)),
    totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    dimensions: dimAverages,
    scoreHistory,
    recentConversations,
  };
}

// --- Save / Update interfaces and functions ---

export interface SaveConversationData {
  user_id: string;
  title?: string;
  started_at: string;
  finished_at: string;
  transcript_text: string;
  source?: string;
  language?: string;
  words_count?: number;
  duration_seconds?: number;
}

export interface SaveSegmentData {
  segment_index: number;
  text: string;
  speaker: string;
  speaker_id: number;
  is_user: boolean;
  start_time: number;
  end_time: number;
}

export interface UpdateEvaluationData {
  title?: string;
  overview?: string;
  emoji?: string;
  category?: string;
  action_items?: ActionItem[];
  communication_feedback?: CommunicationFeedback;
}

export async function saveConversationToSupabase(
  data: SaveConversationData
): Promise<string> {
  const { data: inserted, error } = await supabase
    .from('omi_conversations')
    .insert({
      user_id: data.user_id,
      title: data.title ?? null,
      started_at: data.started_at,
      finished_at: data.finished_at,
      transcript_text: data.transcript_text,
      source: data.source ?? 'maity_desktop',
      language: data.language ?? null,
      words_count: data.words_count ?? null,
      duration_seconds: data.duration_seconds ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error saving conversation to Supabase:', error);
    throw error;
  }

  return inserted.id;
}

export async function saveTranscriptSegments(
  conversationId: string,
  userId: string,
  segments: SaveSegmentData[]
): Promise<void> {
  if (segments.length === 0) return;

  const rows = segments.map((seg) => ({
    conversation_id: conversationId,
    user_id: userId,
    segment_index: seg.segment_index,
    text: seg.text,
    speaker: seg.speaker,
    speaker_id: seg.speaker_id,
    is_user: seg.is_user,
    start_time: seg.start_time,
    end_time: seg.end_time,
  }));

  const { error } = await supabase
    .from('omi_transcript_segments')
    .insert(rows);

  if (error) {
    console.error('Error saving transcript segments:', error);
    throw error;
  }
}

export async function reanalyzeConversation(
  conversationId: string,
  _transcriptText: string, // No longer used — finalize reads segments from Supabase
  _language: string = 'es'
): Promise<OmiConversation> {
  const { invoke } = await import('@tauri-apps/api/core');

  // 1. Get current session JWT
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('No hay sesión activa. Por favor inicia sesión de nuevo.');
  }

  // 2. Get conversation to read duration_seconds
  const conversation = await getOmiConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversación no encontrada');
  }

  // 3. Call finalize endpoint via Rust (no CORS)
  const result = await invoke<{ ok: boolean; error?: string }>('finalize_conversation_cloud', {
    conversationId,
    durationSeconds: conversation.duration_seconds || 0,
    accessToken: session.access_token,
  });

  if (!result.ok) {
    throw new Error(result.error || 'Error al analizar la conversación');
  }

  // 4. Re-fetch and return updated conversation (finalize already wrote to Supabase)
  const updated = await getOmiConversation(conversationId);
  if (!updated) {
    throw new Error('No se pudo obtener la conversación actualizada');
  }

  return updated;
}

export async function toggleActionItemCompleted(
  conversationId: string,
  itemIndex: number,
  completed: boolean
): Promise<void> {
  // Fetch current action_items
  const conversation = await getOmiConversation(conversationId);
  if (!conversation || !conversation.action_items) {
    throw new Error('Conversación o action_items no encontrados');
  }

  const updatedItems = [...conversation.action_items];
  if (itemIndex < 0 || itemIndex >= updatedItems.length) {
    throw new Error('Índice de action_item fuera de rango');
  }

  updatedItems[itemIndex] = { ...updatedItems[itemIndex], completed };

  const { error } = await supabase
    .from('omi_conversations')
    .update({ action_items: updatedItems })
    .eq('id', conversationId);

  if (error) {
    console.error('Error toggling action item:', error);
    throw error;
  }
}

export async function updateConversationEvaluation(
  conversationId: string,
  data: UpdateEvaluationData
): Promise<void> {
  const updatePayload: Record<string, unknown> = {};

  if (data.title !== undefined) updatePayload.title = data.title;
  if (data.overview !== undefined) updatePayload.overview = data.overview;
  if (data.emoji !== undefined) updatePayload.emoji = data.emoji;
  if (data.category !== undefined) updatePayload.category = data.category;
  if (data.action_items !== undefined) updatePayload.action_items = data.action_items;
  if (data.communication_feedback !== undefined) {
    updatePayload.communication_feedback = data.communication_feedback;
  }

  const { error } = await supabase
    .from('omi_conversations')
    .update(updatePayload)
    .eq('id', conversationId);

  if (error) {
    console.error('Error updating conversation evaluation:', error);
    throw error;
  }
}

// ============================================================================
// FORM RESPONSES (self-assessment questionnaire)
// ============================================================================

export interface FormResponse {
  q5?: string; q6?: string;   // Claridad
  q7?: string; q8?: string;   // Adaptación
  q9?: string; q10?: string;  // Persuasión
  q11?: string; q12?: string; // Estructura
  q13?: string; q14?: string; // Propósito
  q15?: string; q16?: string; // Empatía
}

export async function getFormResponses(userId: string): Promise<FormResponse | null> {
  const { data, error } = await supabase
    .from('form_responses')
    .select('q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15, q16')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
