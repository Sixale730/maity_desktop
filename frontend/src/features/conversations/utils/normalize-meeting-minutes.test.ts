import { describe, it, expect } from 'vitest';
import {
  COMPONENT_DISPLAY_NAMES,
  COMPONENT_WEIGHTS,
  normalizeMeetingMinutes,
  getQuienLoDijoDisplay,
  getQuienLoDijoContext,
  getProximaReunionDisplay,
  getClasificacion,
  getAccionDescripcion,
  getCompromisoDescripcion,
} from './normalize-meeting-minutes';
import type {
  MeetingMinutesData,
  MinutaDecision,
} from '../services/conversations.service';

const minimalMinutes = (overrides: Partial<MeetingMinutesData> = {}): MeetingMinutesData =>
  ({
    decisiones: [],
    acciones: { concretas: [], seguimiento: undefined as never },
    acciones_incompletas: [],
    efectividad: undefined,
    ...overrides,
  }) as MeetingMinutesData;

describe('constants', () => {
  it('COMPONENT_DISPLAY_NAMES mapea las 5 métricas de efectividad §7', () => {
    expect(Object.keys(COMPONENT_DISPLAY_NAMES)).toHaveLength(5);
    expect(COMPONENT_DISPLAY_NAMES.agenda_adherence).toBe('Agenda cubierta');
    expect(COMPONENT_DISPLAY_NAMES.decision_ratio).toBe('Decisiones tomadas');
    expect(COMPONENT_DISPLAY_NAMES.action_completeness).toBe('Acciones completas');
    expect(COMPONENT_DISPLAY_NAMES.closure_rate).toBe('Temas cerrados');
    expect(COMPONENT_DISPLAY_NAMES.participation_balance).toBe('Participación equilibrada');
  });

  it('COMPONENT_WEIGHTS suma 1.0 (±0.01)', () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });
});

describe('normalizeMeetingMinutes', () => {
  it('retorna raw si es null/undefined', () => {
    expect(normalizeMeetingMinutes(null as never)).toBeNull();
    expect(normalizeMeetingMinutes(undefined as never)).toBeUndefined();
  });

  it('devuelve arrays vacíos cuando no hay secciones', () => {
    const result = normalizeMeetingMinutes(minimalMinutes());
    expect(result.decisiones).toEqual([]);
    expect(result.acciones_incompletas).toEqual([]);
  });

  describe('decisiones', () => {
    it('copia clasificacion tal cual si existe (formato §7)', () => {
      const input = minimalMinutes({
        decisiones: [
          { clasificacion: 'CONFIRMADA', titulo: 'Comprar CRM', descripcion: 'x' } as MinutaDecision,
        ],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].clasificacion).toBe('CONFIRMADA');
    });

    it('deriva clasificacion desde estado (formato antiguo)', () => {
      const input = minimalMinutes({
        decisiones: [
          { estado: 'CONFIRMADA', descripcion: 'Comprar CRM' } as MinutaDecision,
        ],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].clasificacion).toBe('CONFIRMADA');
    });

    it('cae a "TENTATIVA" si no hay clasificacion ni estado', () => {
      const input = minimalMinutes({
        decisiones: [{ descripcion: 'Algo' } as MinutaDecision],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].clasificacion).toBe('TENTATIVA');
    });

    it('usa descripcion como titulo si falta', () => {
      const input = minimalMinutes({
        decisiones: [{ descripcion: 'Comprar CRM' } as MinutaDecision],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].titulo).toBe('Comprar CRM');
    });

    it('usa cita_textual como cita si falta cita', () => {
      const input = minimalMinutes({
        decisiones: [{ descripcion: 'x', cita_textual: 'Lo hacemos el lunes' } as MinutaDecision],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].cita).toBe('Lo hacemos el lunes');
    });

    it('usa responsable como decidio si falta decidio', () => {
      const input = minimalMinutes({
        decisiones: [{ descripcion: 'x', responsable: 'Ana' } as MinutaDecision],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.decisiones[0].decidio).toBe('Ana');
    });
  });

  describe('seguimiento', () => {
    it('crea estructura por defecto si no hay seguimiento', () => {
      const input = minimalMinutes({
        acciones: { concretas: [], seguimiento: undefined as never },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento).toEqual({
        proxima_reunion: null,
        agenda_sugerida: [],
        preparacion: [],
        distribucion: [],
      });
    });

    it('usa agenda_preliminar como agenda_sugerida si falta', () => {
      const input = minimalMinutes({
        acciones: {
          concretas: [],
          seguimiento: { agenda_preliminar: ['Tema 1', 'Tema 2'] } as never,
        },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento.agenda_sugerida).toEqual(['Tema 1', 'Tema 2']);
      expect(result.acciones.seguimiento.agenda_preliminar).toEqual(['Tema 1', 'Tema 2']);
    });

    it('convierte preparacion_requerida (objetos) a strings "Participante → tarea"', () => {
      const input = minimalMinutes({
        acciones: {
          concretas: [],
          seguimiento: {
            preparacion_requerida: [
              { participante: 'Ana', preparacion: 'revisar propuesta' },
              { participante: 'Bob', preparacion: 'traer números' },
            ],
          } as never,
        },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento.preparacion).toEqual([
        'Ana → revisar propuesta',
        'Bob → traer números',
      ]);
    });

    it('parsea preparacion (strings) a objetos preparacion_requerida', () => {
      const input = minimalMinutes({
        acciones: {
          concretas: [],
          seguimiento: {
            preparacion: ['Ana → revisar propuesta', 'Carlos → traer laptop'],
          } as never,
        },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento.preparacion_requerida).toEqual([
        { participante: 'Ana', preparacion: 'revisar propuesta' },
        { participante: 'Carlos', preparacion: 'traer laptop' },
      ]);
    });

    it('trata strings sin "→" como preparacion sin participante', () => {
      const input = minimalMinutes({
        acciones: {
          concretas: [],
          seguimiento: { preparacion: ['hacer algo indeterminado'] } as never,
        },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento.preparacion_requerida).toEqual([
        { participante: '', preparacion: 'hacer algo indeterminado' },
      ]);
    });

    it('usa distribucion_minuta como distribucion si falta', () => {
      const input = minimalMinutes({
        acciones: {
          concretas: [],
          seguimiento: { distribucion_minuta: ['ana@x.com'] } as never,
        },
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones.seguimiento.distribucion).toEqual(['ana@x.com']);
    });
  });

  describe('acciones_incompletas', () => {
    it('usa descripcion como compromiso si falta', () => {
      const input = minimalMinutes({
        acciones_incompletas: [{ descripcion: 'Enviar reporte' } as never],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones_incompletas[0].compromiso).toBe('Enviar reporte');
      expect(result.acciones_incompletas[0].descripcion).toBe('Enviar reporte');
    });

    it('parsea que_falta "responsable + fecha" a array normalizado', () => {
      const input = minimalMinutes({
        acciones_incompletas: [
          { descripcion: 'x', que_falta: 'Responsable + Fecha' } as never,
        ],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones_incompletas[0].falta).toEqual(['responsable', 'fecha']);
    });

    it('formatea falta array a que_falta string con separador " + "', () => {
      const input = minimalMinutes({
        acciones_incompletas: [
          { descripcion: 'x', falta: ['responsable', 'criterio'] } as never,
        ],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones_incompletas[0].que_falta).toBe('responsable + criterio');
    });

    it('parsea que_falta con comas y espacios', () => {
      const input = minimalMinutes({
        acciones_incompletas: [
          { descripcion: 'x', que_falta: 'responsable, fecha, criterio' } as never,
        ],
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.acciones_incompletas[0].falta).toEqual(['responsable', 'fecha', 'criterio']);
    });
  });

  describe('efectividad componentes', () => {
    it('convierte objeto §7 { key: {valor, justificacion} } a array', () => {
      const input = minimalMinutes({
        efectividad: {
          score_total: 80,
          componentes: {
            agenda_adherence: { valor: 90, justificacion: 'bueno', peso: 0.2 },
            decision_ratio: { valor: 70, justificacion: 'regular' },
          },
        } as never,
      });
      const result = normalizeMeetingMinutes(input);
      const comps = result.efectividad!.componentes as Array<{
        nombre: string;
        score: number;
        justificacion: string;
        peso: number;
      }>;
      expect(comps).toHaveLength(2);
      expect(comps[0]).toMatchObject({
        nombre: 'Agenda cubierta',
        score: 90,
        justificacion: 'bueno',
        peso: 0.2,
      });
      expect(comps[1]).toMatchObject({
        nombre: 'Decisiones tomadas',
        score: 70,
        peso: COMPONENT_WEIGHTS.decision_ratio,
      });
    });

    it('deja array de componentes sin modificar', () => {
      const arr = [{ nombre: 'X', score: 50, justificacion: 'y', peso: 1 }];
      const input = minimalMinutes({
        efectividad: { score_total: 50, componentes: arr } as never,
      });
      const result = normalizeMeetingMinutes(input);
      expect(result.efectividad!.componentes).toBe(arr);
    });

    it('usa la key sin mapeo si no hay display name conocido', () => {
      const input = minimalMinutes({
        efectividad: {
          score_total: 50,
          componentes: { unknown_metric: { valor: 10, justificacion: 'x' } },
        } as never,
      });
      const result = normalizeMeetingMinutes(input);
      const comps = result.efectividad!.componentes as Array<{ nombre: string }>;
      expect(comps[0].nombre).toBe('unknown_metric');
    });
  });
});

describe('getQuienLoDijoDisplay', () => {
  it('retorna null para undefined', () => {
    expect(getQuienLoDijoDisplay(undefined)).toBeNull();
  });

  it('retorna el string tal cual', () => {
    expect(getQuienLoDijoDisplay('Ana')).toBe('Ana');
  });

  it('formatea nombre + rol', () => {
    expect(getQuienLoDijoDisplay({ nombre: 'Ana', rol: 'CEO' })).toBe('Ana (CEO)');
  });

  it('solo nombre cuando no hay rol', () => {
    expect(getQuienLoDijoDisplay({ nombre: 'Ana' })).toBe('Ana');
  });
});

describe('getQuienLoDijoContext', () => {
  it('retorna null para undefined o string', () => {
    expect(getQuienLoDijoContext(undefined)).toBeNull();
    expect(getQuienLoDijoContext('Ana')).toBeNull();
  });

  it('retorna el contexto cuando existe', () => {
    expect(getQuienLoDijoContext({ nombre: 'Ana', contexto: 'abrió la reunión' }))
      .toBe('abrió la reunión');
  });

  it('retorna null cuando no hay contexto', () => {
    expect(getQuienLoDijoContext({ nombre: 'Ana' })).toBeNull();
  });
});

describe('getProximaReunionDisplay', () => {
  it('retorna null para valores falsy', () => {
    expect(getProximaReunionDisplay(null)).toBeNull();
    expect(getProximaReunionDisplay(undefined)).toBeNull();
  });

  it('retorna string tal cual si no dice "no especificado"', () => {
    expect(getProximaReunionDisplay('Martes 3pm')).toBe('Martes 3pm');
  });

  it('filtra strings con "no especificado"', () => {
    expect(getProximaReunionDisplay('No especificado')).toBeNull();
    expect(getProximaReunionDisplay('No especificada')).toBeNull();
  });

  it('concatena fecha + hora + lugar', () => {
    const result = getProximaReunionDisplay({ fecha: '2026-05-10', hora: '15:00', lugar: 'Oficina' });
    expect(result).toBe('2026-05-10 15:00 Oficina');
  });

  it('omite campos con "no especificado"', () => {
    const result = getProximaReunionDisplay({
      fecha: '2026-05-10',
      hora: 'No especificada',
      lugar: 'Oficina',
    });
    expect(result).toBe('2026-05-10 Oficina');
  });

  it('incluye propósito con guión', () => {
    const result = getProximaReunionDisplay({ fecha: '2026-05-10', proposito: 'Cierre' });
    expect(result).toBe('2026-05-10 — Cierre');
  });

  it('retorna null si todos los campos son "no especificado"', () => {
    const result = getProximaReunionDisplay({
      fecha: 'No especificada',
      hora: 'No especificada',
    });
    expect(result).toBeNull();
  });
});

describe('getClasificacion', () => {
  it('prioriza clasificacion sobre estado', () => {
    expect(getClasificacion({ clasificacion: 'CONFIRMADA', estado: 'TENTATIVA' } as MinutaDecision))
      .toBe('CONFIRMADA');
  });

  it('usa estado cuando no hay clasificacion', () => {
    expect(getClasificacion({ estado: 'DIFERIDA' } as MinutaDecision)).toBe('DIFERIDA');
  });

  it('cae a TENTATIVA por defecto', () => {
    expect(getClasificacion({} as MinutaDecision)).toBe('TENTATIVA');
  });
});

describe('getAccionDescripcion / getCompromisoDescripcion', () => {
  it('getAccionDescripcion prioriza accion sobre descripcion', () => {
    expect(getAccionDescripcion({ accion: 'A', descripcion: 'B' })).toBe('A');
    expect(getAccionDescripcion({ descripcion: 'B' })).toBe('B');
    expect(getAccionDescripcion({})).toBe('');
  });

  it('getCompromisoDescripcion prioriza compromiso sobre descripcion', () => {
    expect(getCompromisoDescripcion({ compromiso: 'C', descripcion: 'D' })).toBe('C');
    expect(getCompromisoDescripcion({ descripcion: 'D' })).toBe('D');
    expect(getCompromisoDescripcion({})).toBe('');
  });
});
