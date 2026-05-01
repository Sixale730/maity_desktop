/**
 * Adapter: cloud V4 (shape grande del prompt actual) → Dashboard V1 (shape consumido por componentes).
 *
 * Regla: mapear lo que el cloud devuelve. Lo que no venga queda undefined →
 * el sub-componente no se renderiza. Esto deja gaps visibles para iterar el prompt.
 *
 * Ver `C:/Users/jagv1/.claude/plans/snappy-growing-wirth.md` para tabla completa de mapeos.
 */
import type {
  CommunicationFeedbackV4,
  DimensionItem,
  DimensionesV4,
  ResumenV4,
  CalidadGlobalV4,
  RadiografiaInfo,
  PatronInfo,
  InsightItem,
  Recomendacion,
  SubScore,
} from './types';

const SUB_SCORE_LABELS: Record<string, string> = {
  accion: 'Acción',
  responsable: 'Responsable',
  temporalidad: 'Temporalidad',
  especificidad: 'Especificidad',
  verificabilidad: 'Verificabilidad',
  patron: 'Patrón',
  cohesion: 'Cohesión',
  coherencia: 'Coherencia',
  conectores: 'Conectores',
};

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function adaptDimension(raw: unknown): DimensionItem | undefined {
  const d = asObject(raw);
  const puntaje = typeof d.puntaje === 'number' ? d.puntaje : undefined;
  if (puntaje == null) return undefined;

  const hallazgos = asArray(d.hallazgos);
  const first = asObject(hallazgos[0]);
  const cita = typeof first.cita === 'string' ? first.cita : undefined;
  const prueba_esto = typeof first.alternativa === 'string' ? first.alternativa : undefined;

  const subPuntajes = asObject(d.sub_puntajes);
  const sub_scores: SubScore[] = Object.entries(subPuntajes)
    .map(([key, val]): SubScore | null => {
      const inner = asObject(val);
      const raw1_5 = typeof inner.puntaje_1_5 === 'number' ? inner.puntaje_1_5 : null;
      if (raw1_5 == null) return null;
      return { label: SUB_SCORE_LABELS[key] ?? key, valor: raw1_5 * 20 };
    })
    .filter((x): x is SubScore => x !== null);

  return {
    puntaje,
    nivel: typeof d.nivel === 'string' ? d.nivel : undefined,
    que_significa: typeof d.tu_resultado === 'string' ? d.tu_resultado : undefined,
    cita,
    prueba_esto,
    sub_scores: sub_scores.length > 0 ? sub_scores : undefined,
  };
}

export function cloudV4ToDashboardV1(rawV4: unknown): CommunicationFeedbackV4 {
  const v4 = asObject(rawV4);
  const cgRaw = asObject(v4.calidad_global);
  const radioRaw = asObject(v4.radiografia);
  const patronRaw = asObject(v4.patron);
  const dimsRaw = asObject(v4.dimensiones);
  const resumenRaw = asObject(v4.resumen);

  // resumen ← derivar de calidad_global + bullets/descripcion del bloque resumen del cloud (v5.3+).
  const puntaje = typeof cgRaw.puntaje === 'number' ? cgRaw.puntaje : 0;
  const bullets = asArray(resumenRaw.bullets)
    .filter((b): b is string => typeof b === 'string' && b.length > 0);
  const resumen: ResumenV4 = {
    puntuacion_global: puntaje,
    nivel: typeof cgRaw.nivel === 'string' ? cgRaw.nivel : '',
    descripcion: typeof resumenRaw.descripcion === 'string' ? resumenRaw.descripcion : undefined,
    bullets: bullets.length > 0 ? bullets : undefined,
    fortaleza: typeof cgRaw.fortaleza === 'string' ? cgRaw.fortaleza : undefined,
    fortaleza_hint: typeof cgRaw.fortaleza_hint === 'string' ? cgRaw.fortaleza_hint : undefined,
    mejorar: typeof cgRaw.mejorar === 'string' ? cgRaw.mejorar : undefined,
    mejorar_hint: typeof cgRaw.mejorar_hint === 'string' ? cgRaw.mejorar_hint : undefined,
  };

  const compRaw = asObject(cgRaw.componentes);
  const calidad_global: CalidadGlobalV4 = {
    puntaje,
    componentes: {
      claridad: typeof compRaw.claridad === 'number' ? compRaw.claridad : 0,
      estructura: typeof compRaw.estructura === 'number' ? compRaw.estructura : 0,
      persuasion: typeof compRaw.persuasion === 'number' ? compRaw.persuasion : 0,
      proposito: typeof compRaw.proposito === 'number' ? compRaw.proposito : 0,
      adaptacion: typeof compRaw.adaptacion === 'number' ? compRaw.adaptacion : 0,
      empatia: typeof compRaw.empatia === 'number' ? compRaw.empatia : 0,
    },
  };

  const preguntasRaw = asObject(radioRaw.preguntas);
  const ratioCloud = typeof radioRaw.ratio_habla === 'number' ? radioRaw.ratio_habla : undefined;
  const muletillasDetalleRaw = asObject(radioRaw.muletillas_detalle);
  const muletillas_detalle: Record<string, number> = {};
  for (const [k, v] of Object.entries(muletillasDetalleRaw)) {
    if (typeof v === 'number') muletillas_detalle[k] = v;
  }
  const radiografia: RadiografiaInfo = {
    muletillas_total:
      typeof radioRaw.muletillas_total === 'number' ? radioRaw.muletillas_total : undefined,
    muletillas_frecuencia:
      typeof radioRaw.muletillas_frecuencia === 'string'
        ? radioRaw.muletillas_frecuencia
        : undefined,
    muletillas_detalle:
      Object.keys(muletillas_detalle).length > 0 ? muletillas_detalle : undefined,
    preguntas_total:
      typeof preguntasRaw.usuario === 'number' ? preguntasRaw.usuario : undefined,
    ratio_habla: ratioCloud != null ? Math.round(ratioCloud * 100) : undefined,
  };

  const patron: PatronInfo = {
    actual: typeof patronRaw.actual === 'string' ? patronRaw.actual : undefined,
    evolucion: typeof patronRaw.evolucion === 'string' ? patronRaw.evolucion : undefined,
    que_cambiaria:
      typeof patronRaw.que_cambiaria === 'string' ? patronRaw.que_cambiaria : undefined,
  };

  const insights: InsightItem[] = asArray(v4.insights)
    .map((it): InsightItem | null => {
      const o = asObject(it);
      const dato = typeof o.dato === 'string' ? o.dato : null;
      if (!dato) return null;
      return {
        dato,
        por_que: typeof o.por_que === 'string' ? o.por_que : undefined,
        sugerencia: typeof o.sugerencia === 'string' ? o.sugerencia : undefined,
      };
    })
    .filter((x): x is InsightItem => x !== null);

  const dimensiones: DimensionesV4 = {};
  const DIM_KEYS = [
    'claridad',
    'estructura',
    'persuasion',
    'proposito',
    'empatia',
    'adaptacion',
  ] as const;
  for (const key of DIM_KEYS) {
    const adapted = adaptDimension(dimsRaw[key]);
    if (adapted) dimensiones[key] = adapted;
  }

  const recomendaciones: Recomendacion[] = asArray(v4.recomendaciones)
    .map((it): Recomendacion | null => {
      const o = asObject(it);
      const titulo = typeof o.titulo === 'string' ? o.titulo : null;
      if (!titulo) return null;
      return {
        titulo,
        prioridad: typeof o.prioridad === 'number' ? o.prioridad : undefined,
        descripcion: typeof o.descripcion === 'string' ? o.descripcion : undefined,
        texto_original: typeof o.texto_original === 'string' ? o.texto_original : undefined,
        texto_mejorado: typeof o.texto_mejorado === 'string' ? o.texto_mejorado : undefined,
        impacto: typeof o.impacto === 'string' ? o.impacto : undefined,
        por_que: typeof o.por_que === 'string' ? o.por_que : undefined,
      };
    })
    .filter((x): x is Recomendacion => x !== null);

  return {
    resumen,
    calidad_global,
    radiografia,
    patron: (patron.actual || patron.evolucion) ? patron : undefined,
    insights: insights.length > 0 ? insights : undefined,
    dimensiones: Object.keys(dimensiones).length > 0 ? dimensiones : undefined,
    recomendaciones: recomendaciones.length > 0 ? recomendaciones : undefined,
  };
}
