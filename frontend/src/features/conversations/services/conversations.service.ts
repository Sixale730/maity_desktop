import { supabase } from '@/lib/supabase';

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
  avgClarity: number;
  avgEngagement: number;
  avgStructure: number;
  totalDurationMinutes: number;
  scoreHistory: { date: string; score: number }[];
}

export async function getOmiStats(userId?: string): Promise<OmiStats | null> {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('omi_conversations')
    .select('created_at, duration_seconds, communication_feedback')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching omi stats:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    return {
      totalConversations: 0,
      avgOverallScore: 0,
      avgClarity: 0,
      avgEngagement: 0,
      avgStructure: 0,
      totalDurationMinutes: 0,
      scoreHistory: [],
    };
  }

  // Filter conversations with communication_feedback scores
  const conversationsWithScores = data.filter(
    (c) => c.communication_feedback?.overall_score !== undefined
  );

  // Calculate averages
  const calcAvg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const overallScores = conversationsWithScores
    .map((c) => c.communication_feedback?.overall_score)
    .filter((s): s is number => s !== undefined);

  const clarityScores = conversationsWithScores
    .map((c) => c.communication_feedback?.clarity)
    .filter((s): s is number => s !== undefined);

  const engagementScores = conversationsWithScores
    .map((c) => c.communication_feedback?.engagement)
    .filter((s): s is number => s !== undefined);

  const structureScores = conversationsWithScores
    .map((c) => c.communication_feedback?.structure)
    .filter((s): s is number => s !== undefined);

  // Calculate total duration
  const totalDurationSeconds = data.reduce(
    (acc, c) => acc + (c.duration_seconds || 0),
    0
  );

  // Build score history (last 10 conversations with scores)
  const scoreHistory = conversationsWithScores
    .slice(-10)
    .map((c) => ({
      date: new Date(c.created_at).toLocaleDateString('es-MX', {
        month: 'short',
        day: 'numeric',
      }),
      score: c.communication_feedback?.overall_score || 0,
    }));

  return {
    totalConversations: data.length,
    avgOverallScore: Math.round(calcAvg(overallScores) * 10) / 10,
    avgClarity: Math.round(calcAvg(clarityScores) * 10) / 10,
    avgEngagement: Math.round(calcAvg(engagementScores) * 10) / 10,
    avgStructure: Math.round(calcAvg(structureScores) * 10) / 10,
    totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    scoreHistory,
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
