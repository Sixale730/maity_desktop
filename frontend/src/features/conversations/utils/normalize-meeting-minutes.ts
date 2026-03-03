/**
 * Normalizer for Meeting Minutes data.
 *
 * Converts both old (simplified) and new (§7) JSON formats into
 * a consistent shape that components can consume without branching.
 *
 * Detection: if `decisiones[0]?.clasificacion` exists → §7 format.
 *            if `decisiones[0]?.estado` exists → old format.
 */

import type {
  MeetingMinutesData,
  MinutaDecision,
  MinutaAccionIncompleta,
  MinutaComponenteEfectividad,
  MinutaComponenteEfectividadV7,
  MinutaSeguimientoData,
  MinutaSeguimientoReunion,
  MinutaPreparacionItem,
  MinutaQuienLoDijo,
} from '../services/conversations.service';

// ============================================================================
// COMPONENT NAMES (§7 keys → display names)
// ============================================================================

export const COMPONENT_DISPLAY_NAMES: Record<string, string> = {
  agenda_adherence: 'Agenda cubierta',
  decision_ratio: 'Decisiones tomadas',
  action_completeness: 'Acciones completas',
  closure_rate: 'Temas cerrados',
  participation_balance: 'Participación equilibrada',
};

export const COMPONENT_WEIGHTS: Record<string, number> = {
  agenda_adherence: 0.20,
  decision_ratio: 0.25,
  action_completeness: 0.25,
  closure_rate: 0.15,
  participation_balance: 0.15,
};

// ============================================================================
// MAIN NORMALIZER
// ============================================================================

export function normalizeMeetingMinutes(raw: MeetingMinutesData): MeetingMinutesData {
  if (!raw) return raw;

  return {
    ...raw,
    decisiones: normalizeDecisiones(raw.decisiones),
    acciones: {
      ...raw.acciones,
      seguimiento: normalizeSeguimiento(raw.acciones?.seguimiento),
    },
    acciones_incompletas: normalizeAccionesIncompletas(raw.acciones_incompletas),
    efectividad: raw.efectividad ? {
      ...raw.efectividad,
      componentes: normalizeComponentes(raw.efectividad.componentes),
    } : raw.efectividad,
  };
}

// ============================================================================
// DECISIONES: old `estado` → `clasificacion`
// ============================================================================

function normalizeDecisiones(decisiones: MinutaDecision[] | undefined): MinutaDecision[] {
  if (!decisiones) return [];
  return decisiones.map(d => ({
    ...d,
    clasificacion: d.clasificacion || (d.estado as MinutaDecision['clasificacion']) || 'TENTATIVA',
    titulo: d.titulo || d.descripcion,
    cita: d.cita || d.cita_textual || undefined,
    decidio: d.decidio || (d.responsable ? `${d.responsable}` : undefined),
  }));
}

// ============================================================================
// SEGUIMIENTO: normalize mixed formats
// ============================================================================

function normalizeSeguimiento(seg: MinutaSeguimientoData | undefined): MinutaSeguimientoData {
  if (!seg) return {
    proxima_reunion: null,
    agenda_sugerida: [],
    preparacion: [],
    distribucion: [],
  };

  return {
    ...seg,
    agenda_sugerida: seg.agenda_sugerida || seg.agenda_preliminar || [],
    agenda_preliminar: seg.agenda_preliminar || seg.agenda_sugerida || [],
    preparacion: seg.preparacion || formatPreparacionRequerida(seg.preparacion_requerida as MinutaPreparacionItem[] | undefined),
    preparacion_requerida: seg.preparacion_requerida || parsePreparacionStrings(seg.preparacion),
    distribucion: seg.distribucion || seg.distribucion_minuta || [],
    distribucion_minuta: seg.distribucion_minuta || seg.distribucion || [],
  };
}

function formatPreparacionRequerida(items: MinutaPreparacionItem[] | undefined): string[] {
  if (!items || items.length === 0) return [];
  return items.map(i => `${i.participante} → ${i.preparacion}`);
}

function parsePreparacionStrings(strings: string[] | undefined): MinutaPreparacionItem[] {
  if (!strings || strings.length === 0) return [];
  return strings.map(s => {
    const parts = s.split('→').map(p => p.trim());
    if (parts.length === 2) {
      return { participante: parts[0], preparacion: parts[1] };
    }
    return { participante: '', preparacion: s };
  });
}

// ============================================================================
// ACCIONES INCOMPLETAS: normalize quien_lo_dijo and falta
// ============================================================================

function normalizeAccionesIncompletas(acciones: MinutaAccionIncompleta[] | undefined): MinutaAccionIncompleta[] {
  if (!acciones) return [];
  return acciones.map(a => ({
    ...a,
    compromiso: a.compromiso || a.descripcion,
    descripcion: a.descripcion || a.compromiso,
    falta: a.falta || parseFaltaString(a.que_falta),
    que_falta: a.que_falta || formatFaltaArray(a.falta),
  }));
}

function parseFaltaString(queFalta: string | undefined): string[] {
  if (!queFalta) return [];
  return queFalta.split(/\s*[+,]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function formatFaltaArray(falta: string[] | undefined): string {
  if (!falta || falta.length === 0) return '';
  return falta.join(' + ');
}

// ============================================================================
// EFECTIVIDAD COMPONENTES: object → array
// ============================================================================

function normalizeComponentes(
  componentes: MinutaComponenteEfectividad[] | Record<string, MinutaComponenteEfectividadV7> | undefined
): MinutaComponenteEfectividad[] {
  if (!componentes) return [];

  if (Array.isArray(componentes)) {
    return componentes;
  }

  const entries = Object.entries(componentes) as [string, MinutaComponenteEfectividadV7][];
  return entries.map(([key, comp]) => ({
    nombre: COMPONENT_DISPLAY_NAMES[key] || key,
    score: comp.valor,
    justificacion: comp.justificacion,
    peso: comp.peso ?? COMPONENT_WEIGHTS[key],
  }));
}

// ============================================================================
// HELPERS for components
// ============================================================================

export function getQuienLoDijoDisplay(quien: string | MinutaQuienLoDijo | undefined): string | null {
  if (!quien) return null;
  if (typeof quien === 'string') return quien;
  const parts = [quien.nombre];
  if (quien.rol) parts.push(`(${quien.rol})`);
  return parts.join(' ');
}

export function getQuienLoDijoContext(quien: string | MinutaQuienLoDijo | undefined): string | null {
  if (!quien || typeof quien === 'string') return null;
  return quien.contexto || null;
}

const isUnspecified = (s: string) => s.toLowerCase().includes('no especificad');

export function getProximaReunionDisplay(proxima: string | MinutaSeguimientoReunion | null | undefined): string | null {
  if (!proxima) return null;
  if (typeof proxima === 'string') return isUnspecified(proxima) ? null : proxima;
  const parts: string[] = [];
  if (proxima.fecha && !isUnspecified(proxima.fecha)) parts.push(proxima.fecha);
  if (proxima.hora && !isUnspecified(proxima.hora)) parts.push(proxima.hora);
  if (proxima.lugar && !isUnspecified(proxima.lugar)) parts.push(proxima.lugar);
  if (proxima.proposito && !isUnspecified(proxima.proposito)) parts.push(`— ${proxima.proposito}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function getClasificacion(decision: MinutaDecision): 'CONFIRMADA' | 'TENTATIVA' | 'DIFERIDA' {
  return (decision.clasificacion || decision.estado || 'TENTATIVA') as 'CONFIRMADA' | 'TENTATIVA' | 'DIFERIDA';
}

export function getAccionDescripcion(accion: { descripcion?: string; accion?: string }): string {
  return accion.accion || accion.descripcion || '';
}

export function getCompromisoDescripcion(accion: { descripcion?: string; compromiso?: string }): string {
  return accion.compromiso || accion.descripcion || '';
}
