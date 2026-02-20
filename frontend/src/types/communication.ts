/**
 * Communication feedback types for meeting analysis
 * Matches the Rust CommunicationFeedback struct
 */

export interface CommunicationObservations {
  /** Observation about clarity of communication */
  clarity?: string;
  /** Observation about structure of the discourse */
  structure?: string;
  /** How objections were handled */
  objections?: string;
  /** Analysis of calls to action */
  calls_to_action?: string;
}

export interface CommunicationFeedback {
  /** Overall communication score (0-10) */
  overall_score?: number;
  /** Clarity score (0-10) */
  clarity?: number;
  /** Engagement score (0-10) — legacy, prefer adaptacion */
  engagement?: number;
  /** Structure score (0-10) */
  structure?: number;
  /** Empathy score (0-10) */
  empatia?: number;
  /** Vocabulary score (0-10) */
  vocabulario?: number;
  /** Objective score (0-10) */
  objetivo?: number;
  /** Adaptation score (0-10) */
  adaptacion?: number;
  /** General feedback text */
  feedback?: string;
  /** Summary of the communication analysis (alternative to feedback) */
  summary?: string;
  /** List of communication strengths */
  strengths?: string[];
  /** List of areas that need improvement */
  areas_to_improve?: string[];
  /** Detailed observations by category */
  observations?: CommunicationObservations;
  /** Counters and detailed metrics */
  counters?: {
    pero_count?: number;
    filler_words?: Record<string, number>;
    objection_words?: Record<string, number>;
    objections_made?: string[];
    objections_received?: string[];
  };
  /** Speech radiography */
  radiografia?: {
    ratio_habla?: number;
    palabras_usuario?: number;
    palabras_otros?: number;
    muletillas_total?: number;
    muletillas_detectadas?: Record<string, number>;
    muletillas_frecuencia?: string;
  };
  /** Questions analysis */
  preguntas?: {
    total_usuario?: number;
    total_otros?: number;
    preguntas_usuario?: string[];
    preguntas_otros?: string[];
  };
  /** Topics analysis */
  temas?: {
    temas_tratados?: string[];
    acciones_usuario?: (string | { descripcion: string; tiene_fecha: boolean })[];
    temas_sin_cerrar?: (string | { tema: string; razon: string })[];
  };
  /** Meeting minutes markdown */
  meeting_minutes?: string;
  /** Communication pattern */
  patron?: {
    actual: string;
    evolucion: string;
    senales: string[];
    que_cambiaria: string;
  };
  /** Hidden insights */
  insights?: Array<{
    dato: string;
    por_que: string;
    sugerencia: string;
  }>;
}
