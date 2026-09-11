import { describe, it, expect } from 'vitest';
import { buildEnvelope, HERO_BAR_COUNT } from './BatchRecordingHero';
import { formatClock } from '@/components/coach/TalkTimeRing';

describe('BatchRecordingHero · buildEnvelope', () => {
  it('produce una escala por barra, todas dentro de (0, 1]', () => {
    const env = buildEnvelope(HERO_BAR_COUNT);
    expect(env).toHaveLength(HERO_BAR_COUNT);
    for (const v of env) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('es un arco: los extremos son más bajos que el centro', () => {
    const env = buildEnvelope(HERO_BAR_COUNT);
    const mid = env[Math.floor(HERO_BAR_COUNT / 2)];
    expect(env[0]).toBeLessThan(mid);
    expect(env[HERO_BAR_COUNT - 1]).toBeLessThan(mid);
  });

  it('es determinista para la misma semilla y distinta entre semillas', () => {
    expect(buildEnvelope(10, 7)).toEqual(buildEnvelope(10, 7));
    expect(buildEnvelope(10, 7)).not.toEqual(buildEnvelope(10, 11));
  });
});

describe('TalkTimeRing · formatClock', () => {
  it('formatea mm:ss sin hora y h:mm:ss con hora', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(724)).toBe('12:04');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('no revienta con valores raros', () => {
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
  });
});
