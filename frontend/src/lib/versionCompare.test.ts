import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isNewerVersion } from './versionCompare';

describe('parseVersion', () => {
  it('acepta X.Y.Z y X.Y.Z.W, con o sin prefijo v', () => {
    expect(parseVersion('0.2.57')).toEqual([0, 2, 57]);
    expect(parseVersion('0.2.57.0')).toEqual([0, 2, 57, 0]);
    expect(parseVersion('v0.2.58')).toEqual([0, 2, 58]);
    expect(parseVersion('  1.0  ')).toEqual([1, 0]);
  });

  it('rechaza basura', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('0.2.57-beta')).toBeNull();
    expect(parseVersion('0.2.57.0.1')).toBeNull();
    expect(parseVersion('0..2')).toBeNull();
    // @ts-expect-error — defensa contra valores no-string leídos de system_config
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compara por segmento numérico, no lexicográfico', () => {
    expect(compareVersions('0.2.57', '0.2.56')).toBe(1);
    expect(compareVersions('0.2.9', '0.2.10')).toBe(-1);
    expect(compareVersions('0.3.0', '0.2.99')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('trata las partes faltantes como 0 (MSIX 4 partes == semver 3 partes)', () => {
    expect(compareVersions('0.2.57', '0.2.57.0')).toBe(0);
    expect(compareVersions('0.2.57.1', '0.2.57')).toBe(1);
  });

  it('devuelve null si alguna no parsea', () => {
    expect(compareVersions('0.2.57', 'latest')).toBeNull();
    expect(compareVersions('', '0.2.57')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('true solo cuando la remota es estrictamente mayor', () => {
    expect(isNewerVersion('0.2.58', '0.2.57')).toBe(true);
    expect(isNewerVersion('0.2.57', '0.2.57')).toBe(false);
    expect(isNewerVersion('0.2.56', '0.2.57')).toBe(false);
  });

  it('inválida → false (nunca avisar por un valor corrupto en system_config)', () => {
    expect(isNewerVersion('latest', '0.2.57')).toBe(false);
    expect(isNewerVersion('0.2.58', '')).toBe(false);
  });
});
