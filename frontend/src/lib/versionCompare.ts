/**
 * Comparación de versiones para el aviso de actualización del canal Store (#71).
 *
 * Acepta `X.Y.Z` (lo que devuelve `getVersion()` desde `tauri.conf.json`) y
 * `X.Y.Z.0` (formato de 4 partes del `Package.appxmanifest` MSIX), con o sin
 * prefijo `v`. Las partes faltantes cuentan como 0, así `0.2.57` == `0.2.57.0`.
 *
 * No se usa la crate/paquete `semver`: las versiones de Maity son numéricas
 * puras (sin pre-release ni build metadata) y traer una dependencia para tres
 * enteros no se justifica.
 */

export function parseVersion(raw: string): number[] | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,3}$/.test(trimmed)) return null;
  return trimmed.split('.').map((part) => Number.parseInt(part, 10));
}

/**
 * @returns 1 si `a > b`, -1 si `a < b`, 0 si son iguales, `null` si alguna no parsea.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** `true` solo cuando `remote` es estrictamente mayor que `current`. Inválidas → `false`. */
export function isNewerVersion(remote: string, current: string): boolean {
  return compareVersions(remote, current) === 1;
}
