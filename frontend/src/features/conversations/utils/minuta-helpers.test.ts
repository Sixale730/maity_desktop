import { describe, it, expect } from 'vitest';
import { isMinutaInsufficient } from './minuta-helpers';
import type { MeetingMinutesData } from '../services/conversations.service';

const emptyMinuta = {
  meta: { titulo: 'x', fecha: '2026-05-01', duracion_min: 0, participantes: [] },
  temas: [],
  decisiones: [],
  acciones: { lista: [], seguimiento: null },
  acciones_incompletas: [],
  efectividad: { score_global: 0, componentes: [] },
  graficas: {},
} as unknown as MeetingMinutesData;

describe('isMinutaInsufficient', () => {
  it('retorna true para null/undefined', () => {
    expect(isMinutaInsufficient(null)).toBe(true);
    expect(isMinutaInsufficient(undefined)).toBe(true);
  });

  it('retorna true cuando todos los campos estan vacios', () => {
    expect(isMinutaInsufficient(emptyMinuta)).toBe(true);
  });

  it('retorna true cuando temas es undefined', () => {
    const m = { ...emptyMinuta, temas: undefined } as unknown as MeetingMinutesData;
    expect(isMinutaInsufficient(m)).toBe(true);
  });

  it('retorna false cuando hay al menos UNA decision', () => {
    const m = {
      ...emptyMinuta,
      decisiones: [{ titulo: 'D1', clasificacion: 'TENTATIVA' }],
    } as unknown as MeetingMinutesData;
    expect(isMinutaInsufficient(m)).toBe(false);
  });

  it('retorna false cuando hay al menos UNA accion en la lista', () => {
    const m = {
      ...emptyMinuta,
      acciones: { lista: [{ descripcion: 'A1', responsable: 'X' }], seguimiento: null },
    } as unknown as MeetingMinutesData;
    expect(isMinutaInsufficient(m)).toBe(false);
  });

  it('retorna false cuando hay al menos UN tema', () => {
    const m = {
      ...emptyMinuta,
      temas: [{ nombre: 'T1', titulo: 'T1', resumen: '...' }],
    } as unknown as MeetingMinutesData;
    expect(isMinutaInsufficient(m)).toBe(false);
  });

  it('retorna false cuando hay componentes de efectividad', () => {
    const m = {
      ...emptyMinuta,
      efectividad: {
        score_global: 80,
        componentes: [{ key: 'agenda_adherence', score: 1 }],
      },
    } as unknown as MeetingMinutesData;
    expect(isMinutaInsufficient(m)).toBe(false);
  });
});
