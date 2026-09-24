/**
 * Candado duro del ACL del updater (B2, #83).
 *
 * Por qué existe: en Windows `tauri-plugin-updater` termina el update con
 * `std::process::exit(0)` (`updater.rs:865`), así que un `download()`,
 * `install()` o `downloadAndInstall()` llamado desde el webview mata el
 * proceso SIN correr `RunEvent::Exit`: la grabación activa no se guarda, el
 * pool de SQLite queda abierto y `llama-helper.exe` bloquea el instalador.
 * El único camino soportado es `invoke('direct_update_install')`
 * (`direct_update.rs`, ver `docs/CANALES_DISTRIBUCION.md` § B2), que hace su
 * propia limpieza en un `on_before_exit` propio antes de instalar.
 *
 * Este test es el candado en dos capas:
 *   1. Ningún archivo de `src` (fuera de tests) llama `downloadAndInstall(`,
 *      `invoke('plugin:updater|…')`, ni `.install(`/`.download(` sobre un
 *      archivo que importe `@tauri-apps/plugin-updater`.
 *   2. La capability `main` de `tauri.conf.json` concede SOLO
 *      `updater:allow-check` (el JS solo necesita `check()` como sonda de
 *      disponibilidad) — nunca `updater:default`, `updater:allow-install`,
 *      `updater:allow-download` ni `updater:allow-download-and-install`.
 *
 * Mismo molde que `src/app/(aux)/layout.test.ts` (readdirSync/statSync/
 * readFileSync de node:fs, recorrido recursivo con `walk`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '..', '..'); // frontend/src
const TAURI_CONF = path.resolve(SRC, '..', 'src-tauri', 'tauri.conf.json');

/**
 * Quita comentarios de bloque `/* … *\/` y de línea `// …` sin tocar URLs
 * como `https://`: solo cuenta como comentario de línea el `//` que NO va
 * precedido de `:` (así la documentación que menciona `downloadAndInstall()`
 * en un comentario no dispara el detector).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Pura: devuelve una descripción por cada llamada prohibida encontrada en
 * `source` (ya con comentarios adentro; esta función limpia por su cuenta).
 */
export function findUpdaterInstallCalls(file: string, source: string): string[] {
  const clean = stripComments(source);
  const violations: string[] = [];

  if (/\bdownloadAndInstall\s*\(/.test(clean)) {
    violations.push(`${file}: downloadAndInstall(...) — usar invoke('direct_update_install')`);
  }
  if (/plugin:updater\|(install|download|download_and_install)\b/.test(clean)) {
    violations.push(`${file}: invoke('plugin:updater|...') — usar invoke('direct_update_install')`);
  }
  if (/from\s+['"]@tauri-apps\/plugin-updater['"]/.test(clean) && /\.(install|download)\s*\(/.test(clean)) {
    violations.push(`${file}: .install(...)/.download(...) sobre el plugin — usar invoke('direct_update_install')`);
  }

  return violations;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

function isScannable(file: string): boolean {
  return /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file);
}

describe('updater — solo direct_update_install instala (B2, #83)', () => {
  it('ningún archivo de src instala updates del plugin desde JS', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      if (!isScannable(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const v of findUpdaterInstallCalls(rel(file), source)) violations.push(v);
    }
    expect(
      violations,
      '\nSe encontró una llamada de instalación del plugin updater desde el webview. En Windows mata el proceso ' +
        'con std::process::exit(0) sin correr RunEvent::Exit: la grabación no se guarda, la DB queda abierta y ' +
        "llama-helper.exe bloquea el instalador. El único camino es invoke('direct_update_install') (direct_update.rs, B2).\n",
    ).toEqual([]);
  });

  it('el detector no es vacuo', () => {
    expect(
      findUpdaterInstallCalls('x.ts', "import { check } from '@tauri-apps/plugin-updater';\nawait u.install();").length,
    ).toBe(1);
    expect(findUpdaterInstallCalls('x.ts', 'await u.downloadAndInstall(cb)').length).toBe(1);
    expect(
      findUpdaterInstallCalls('x.ts', "invoke('plugin:updater|download_and_install')").length,
    ).toBe(1);
    expect(findUpdaterInstallCalls('x.ts', '// nunca uses downloadAndInstall() aquí').length).toBe(0);
    expect(findUpdaterInstallCalls('x.ts', 'server.install()').length).toBe(0);
  });

  it('la capability main solo concede updater:allow-check', () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
    const capabilities = ((conf.app || {}).security || {}).capabilities || [];
    const main = capabilities.find((cap: { identifier?: string }) => cap.identifier === 'main');
    expect(main, 'no se encontró la capability "main" en tauri.conf.json').toBeTruthy();

    const perms: string[] = (main.permissions || []).map((p: unknown) =>
      typeof p === 'string' ? p : (p as { identifier: string }).identifier,
    );

    expect(perms).toContain('updater:allow-check');
    for (const forbidden of [
      'updater:default',
      'updater:allow-install',
      'updater:allow-download',
      'updater:allow-download-and-install',
    ]) {
      expect(perms, `la capability "main" no debe conceder ${forbidden}`).not.toContain(forbidden);
    }
  });
});
