import { describe, it, expect } from 'vitest';
import { cloudV4ToDashboardV1, DIM_KEYS } from './adapter';

/** Payload 6.1 mínimo con las seis dimensiones medidas. */
function fullPayload(overrides: Record<string, unknown> = {}) {
  return {
    analysis_version: '6.1',
    calidad_global: {
      puntaje: 71,
      nivel: 'competente',
      componentes: { claridad: 80, estructura: 70, persuasion: 65, proposito: 75, empatia: 60, adaptacion: 76 },
      fortaleza: 'Claridad',
      mejorar: 'Empatía',
    },
    resumen: { bullets: ['Hablaste claro.'] },
    ...overrides,
  };
}

describe('cloudV4ToDashboardV1 — no_aplica (#74)', () => {
  it('payload completo: sin no_aplica, y el puntaje sale de calidad_global.puntaje', () => {
    const out = cloudV4ToDashboardV1(fullPayload());
    expect(out.calidad_global?.no_aplica).toBeUndefined();
    expect(out.calidad_global?.puntaje).toBe(71);
    expect(out.resumen?.puntuacion_global).toBe(71);
    expect(out.resumen?.fortaleza).toBe('Claridad');
  });

  it('6.x: respeta dimensiones_no_aplica tal como lo estampó el analyzer', () => {
    const out = cloudV4ToDashboardV1(
      fullPayload({
        dimensiones_no_aplica: ['empatia', 'adaptacion'],
        calidad_global: {
          puntaje: 72,
          componentes: { claridad: 80, estructura: 70, persuasion: 65, proposito: 75, empatia: 0, adaptacion: 0 },
        },
      }),
    );
    expect(out.calidad_global?.no_aplica).toEqual(['empatia', 'adaptacion']);
  });

  it('pre ago-2026: recording_mode=presentation sin lista ⇒ empatía y adaptación no aplican', () => {
    const out = cloudV4ToDashboardV1(fullPayload({ recording_mode: 'presentation' }));
    expect(out.calidad_global?.no_aplica).toEqual(['empatia', 'adaptacion']);
  });

  it('componente null sin marcadores ⇒ entra a no_aplica en vez de pintarse como 0', () => {
    const out = cloudV4ToDashboardV1(
      fullPayload({
        calidad_global: {
          puntaje: 72,
          componentes: { claridad: 80, estructura: 70, persuasion: 65, proposito: 75, empatia: null, adaptacion: 76 },
        },
      }),
    );
    expect(out.calidad_global?.no_aplica).toEqual(['empatia']);
    // El shape numérico se conserva para los consumidores que no miran no_aplica.
    expect(out.calidad_global?.componentes.empatia).toBe(0);
    expect(out.calidad_global?.componentes.adaptacion).toBe(76);
  });

  it('la lista se ordena como el radar y dedupea lo que venga por dos vías', () => {
    const out = cloudV4ToDashboardV1(
      fullPayload({
        dimensiones_no_aplica: ['adaptacion'],
        calidad_global: {
          puntaje: 72,
          componentes: { claridad: 80, estructura: 70, persuasion: 65, proposito: 75, empatia: null, adaptacion: null },
        },
      }),
    );
    expect(out.calidad_global?.no_aplica).toEqual(['empatia', 'adaptacion']);
    expect(DIM_KEYS.indexOf('empatia')).toBeLessThan(DIM_KEYS.indexOf('adaptacion'));
  });

  it('ignora valores no-string en dimensiones_no_aplica y entradas no-objeto', () => {
    const out = cloudV4ToDashboardV1(fullPayload({ dimensiones_no_aplica: [42, null, 'empatia'] }));
    expect(out.calidad_global?.no_aplica).toEqual(['empatia']);
    expect(cloudV4ToDashboardV1(null).calidad_global?.no_aplica).toBeUndefined();
  });
});
