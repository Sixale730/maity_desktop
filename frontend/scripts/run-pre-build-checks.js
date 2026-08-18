#!/usr/bin/env node
// Pre-build checks. Runs BEFORE tauri:build / tauri:build:debug.
// Currently: state-access lint (fast, ~1s) + providers-tree lint (fast, <100ms)
// + tauri-events lint (fast, <1s) + telemetry lint + tauri-acl lint (fast, <1s)
// + migrations LF/checksum + llama-helper provenance (cargo cacheado, ~s; la
// primera vez compila llama.cpp) + vitest (~45s).
//
// Orden deliberado: los checks BARATOS van primero para fallar rápido; la suite
// de vitest va al final porque es la más lenta (~45s) y la que menos veces falla.
//
// To skip (NOT recommended), use: pnpm run tauri:build:debug:skip-checks

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LINT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'lint-state-access.sh');
const PROVIDERS_TREE_SCRIPT = path.join(__dirname, 'lint-providers-tree.js');
const TAURI_EVENTS_SCRIPT = path.join(__dirname, 'lint-tauri-events.js');
const TELEMETRY_SCRIPT = path.join(__dirname, 'lint-telemetry.js');
const TAURI_ACL_SCRIPT = path.join(__dirname, 'lint-tauri-acl.js');
const VERIFY_HELPER_SCRIPT = path.join(__dirname, 'verify-helper-binary.js');
// On Windows, bash (Git Bash/MINGW) treats backslashes as escapes, mangling
// `C:\maity_desktop\...` into `C:maity_desktop...`. Forward slashes work on
// every platform.
const BASH_LINT_SCRIPT = LINT_SCRIPT.replace(/\\/g, '/');

// On Windows, `bash` in PATH may resolve to WSL's bash (C:\Windows\System32\bash.exe),
// which only sees `/mnt/c/...` paths. Force Git Bash when available so we can pass
// native Windows paths.
function resolveBash() {
    if (process.platform !== 'win32') return 'bash';
    const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'bash';
}

const BASH = resolveBash();

// Primero de todo: el VC++ Runtime tiene que estar staged ANTES de que el
// bundler recoja bundle.resources (ver stage-vcredist.js).
console.log('[pre-build] Staging VC++ Runtime redistributable...');
const vcredistResult = spawnSync(process.execPath, [path.join(__dirname, 'stage-vcredist.js')], {
    stdio: 'inherit',
    shell: false,
});

if (vcredistResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: no se pudo stagear el VC++ Runtime.');
    console.error('  Sin msvcp140/vcruntime140 junto al .exe, Maity no arranca en un Windows');
    console.error('  limpio (crash "MSVCP140.dll was not found" — cert Store 10.2.4.1).');
    process.exit(1);
}

console.log('[pre-build] OK: VC++ Runtime staged');

console.log('[pre-build] Running state-access lint...');

const result = spawnSync(BASH, [BASH_LINT_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (result.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: state-access lint failed.');
    console.error('  Fix the violations above, or add `// state-allow: <reason>` if intentional.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: state-access lint passed');

console.log('[pre-build] Running providers-tree lint...');
const treeResult = spawnSync(process.execPath, [PROVIDERS_TREE_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (treeResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: providers-tree lint failed.');
    console.error('  Restore the MARKER comment in src/app/layout.tsx, or update');
    console.error('  PROVIDER_INVARIANTS in src/app/layout.test.ts if intentional.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: providers-tree lint passed');

console.log('[pre-build] Running tauri-events lint...');
const eventsResult = spawnSync(process.execPath, [TAURI_EVENTS_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (eventsResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: tauri-events lint failed.');
    console.error('  Usa las constantes de src-tauri/src/events.rs (Rust) o');
    console.error('  src/lib/tauri-events.ts (TS) en vez de strings inline, y mantén');
    console.error('  ambos archivos como espejo exacto. Escape por línea: // event-allow: <razón>');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: tauri-events lint passed');

console.log('[pre-build] Running telemetry lint...');
const telemetryResult = spawnSync(process.execPath, [TELEMETRY_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (telemetryResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: telemetry lint failed.');
    console.error('  El contrato de telemetría vive en docs/TELEMETRIA.md: evento nuevo =');
    console.error('  3 entradas (lib/telemetry-events.ts + catalog.rs + fila en el doc).');
    console.error('  Single writer: insert_platform_log solo desde platformLogger.ts y drain.rs.');
    console.error('  Escape por línea: // telemetry-allow: <razón>');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: telemetry lint passed');

console.log('[pre-build] Running tauri-acl lint...');
const aclResult = spawnSync(process.execPath, [TAURI_ACL_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (aclResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: tauri-acl lint failed.');
    console.error('  El código ejerce un permiso que la capability de esa ventana no declara');
    console.error('  (tauri.conf.json → app.security.capabilities). El caso invisible:');
    console.error('  onCloseRequested sin preventDefault() destruye la ventana → allow-destroy.');
    console.error('  Escape por línea: // acl-allow: <razón>');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: tauri-acl lint passed');

console.log('[pre-build] Running migrations LF/checksum check...');
const migrationsResult = spawnSync(process.execPath, [path.join(__dirname, 'verify-migrations-lf.js')], {
    stdio: 'inherit',
    shell: false,
});

if (migrationsResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: migrations check failed.');
    console.error('  Migraciones con CRLF o checksum alterado producen binarios que rompen');
    console.error('  la SQLite de usuarios existentes ("previously applied but has been modified").');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: migrations check passed');

// Provenance del sidecar: compila llama-helper (cacheado; la primera vez tarda
// minutos por llama.cpp) y compara SHA-256 con el bundleado en src-tauri/binaries/.
// Va antes de vitest: si falla, el mensaje sale sin esperar los ~45s de tests.
console.log('[pre-build] Running llama-helper provenance check...');
const helperResult = spawnSync(process.execPath, [VERIFY_HELPER_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (helperResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: llama-helper provenance check failed.');
    console.error('  El sidecar bundleado (gitignored, copiado a mano) no corresponde al código');
    console.error('  de llama-helper/. Así se embarcaron 3 meses de helper stale (jul-2026).');
    console.error('  Regenerar: node scripts/verify-helper-binary.js --fix');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: llama-helper provenance check passed');

// Vitest al final: es el check más lento (~45s). Va DENTRO del pre-build (y no
// como paso manual) porque los tests de invariantes — layout.test.ts con
// PROVIDER_INVARIANTS, los guards de arranque, la preservación de audio sin
// transcripts — solo previenen regresiones si el build los ejecuta. Una suite
// que nadie corre es documentación, no una red de seguridad.
console.log('[pre-build] Running vitest suite...');

// Mismo patrón que resolveBash(): preferir el entrypoint .mjs (ejecutable con
// `node`, sin shell) y caer al shim de node_modules/.bin sólo si no está.
function resolveVitest() {
    const mjs = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
    if (fs.existsSync(mjs)) return { cmd: process.execPath, args: [mjs, 'run'], shell: false };

    const binName = process.platform === 'win32' ? 'vitest.CMD' : 'vitest';
    const bin = path.join(__dirname, '..', 'node_modules', '.bin', binName);
    if (fs.existsSync(bin)) return { cmd: bin, args: ['run'], shell: process.platform === 'win32' };

    return null;
}

const vitest = resolveVitest();

if (!vitest) {
    console.error('');
    console.error('[pre-build] FAIL: no se encontró vitest en node_modules.');
    console.error('  Corre `pnpm install` en frontend/ antes de buildear.');
    process.exit(1);
}

const testResult = spawnSync(vitest.cmd, vitest.args, {
    stdio: 'inherit',
    shell: vitest.shell,
    cwd: path.join(__dirname, '..'),
});

if (testResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: la suite de vitest falló.');
    console.error('  Estos tests blindan invariantes que ya causaron incidentes en producción');
    console.error('  (orden de providers, guards de arranque, no descartar audio sin transcripts).');
    console.error('  Corre `pnpm test` para ver el detalle.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: vitest suite passed');
