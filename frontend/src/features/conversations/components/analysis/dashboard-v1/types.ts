export interface Recomendacion {
  titulo: string;
  descripcion?: string;
  texto_original?: string;
  texto_mejorado?: string;
  impacto?: string;
  por_que?: string;
  prioridad?: number;
}

export interface CalidadGlobalV4 {
  puntaje: number;
  componentes: {
    claridad: number;
    estructura: number;
    persuasion: number;
    proposito: number;
    adaptacion: number;
    empatia: number;
  };
}

export interface ResumenV4 {
  puntuacion_global: number;
  nivel: string;
  descripcion?: string;
  bullets?: string[];
  fortaleza?: string;
  fortaleza_hint?: string;
  mejorar?: string;
  mejorar_hint?: string;
}

export interface RadiografiaInfo {
  muletillas_total?: number;
  muletillas_frecuencia?: string;
  muletillas_detalle?: Record<string, number>;
  preguntas_total?: number;
  ratio_habla?: number;
}

export interface PatronInfo {
  actual?: string;
  evolucion?: string;
  que_cambiaria?: string;
}

export interface InsightItem {
  dato: string;
  por_que?: string;
  sugerencia?: string;
}

export interface SubScore {
  label: string;
  valor: number;
}

export interface DimensionItem {
  puntaje: number;
  nivel?: string;
  que_significa?: string;
  cita?: string;
  prueba_esto?: string;
  sub_scores?: SubScore[];
}

export interface DimensionesV4 {
  claridad?: DimensionItem;
  estructura?: DimensionItem;
  persuasion?: DimensionItem;
  proposito?: DimensionItem;
  empatia?: DimensionItem;
  adaptacion?: DimensionItem;
}

export interface CommunicationFeedbackV4 {
  resumen?: ResumenV4;
  calidad_global?: CalidadGlobalV4;
  radiografia?: RadiografiaInfo;
  patron?: PatronInfo;
  insights?: InsightItem[];
  dimensiones?: DimensionesV4;
  recomendaciones?: Recomendacion[];
}
