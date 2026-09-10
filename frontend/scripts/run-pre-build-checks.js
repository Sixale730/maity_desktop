#!/usr/bin/env node
// Pre-build checks. Runs BEFORE tauri:build / tauri:build:debug.
// Currently: state-access lint (fast, ~1s) + providers-tree lint (fast, <100ms)
// + tauri-events lint (fast, <1s) + telemetry lint + tauri-acl lint (fast, <1s)
// + cargo-workspace lint (manifiestos, <50ms) + cargo-deps lint (cargo tree, ~2-4s)
// + migrations LF/checksum + llama-helper
// provenance (cargo cacheado, ~s; la primera vez compila llama.cpp) + vitest (~45s).
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
const CARGO_DEPS_SCRIPT = path.join(__dirname, 'lint-cargo-deps.js');
const CARGO_WORKSPACE_SCRIPT = path.join(__dirname, 'lint-cargo-workspace.js');
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

// Antes que nada: GC del target/ de Cargo (sesiones incrementales y rlibs hasheados
// viejos de app_lib) + chequeo de espacio libre. Sin esto el disco se llenaba solo
// (43.7 GB en ~40 sesiones, 2026-09-09) y el build moría a mitad del link con
// "os error 112". Sólo el exit 1 (espacio libre < 5 GB) detiene el build; cualquier
// otro fallo del GC se avisa y se sigue, porque un GC roto no debe bloquear builds.
console.log('[pre-build] Running target/ GC + free-space check...');
const gcResult = spawnSync(process.execPath, [path.join(__dirname, 'gc-target-dir.js')], {
    stdio: 'inherit',
    shell: false,
});

if (gcResult.status === 1) {
    console.error('');
    console.error('[pre-build] FAIL: no hay espacio suficiente para buildear (ver arriba).');
    console.error('  Escape hatch: MAITY_TARGET_GC_NO_FAIL=1 o pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
} else if (gcResult.status !== 0) {
    console.warn(`[pre-build] WARN: el GC del target/ terminó con exit ${gcResult.status}; se continúa.`);
}

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

// macOS: ffmpeg universal LGPL como sidecar (externalBin en tauri.macos.conf.json).
// Tiene que existir ANTES de que el bundler recoja externalBin. Sin él no se genera
// audio.mp4 al terminar una grabación, y la App Store no admite la descarga en
// runtime que hacía audio/ffmpeg.rs (guideline 2.5.2, issue #77). El script es
// idempotente: si el stamp coincide sale en segundos; la primera vez compila (~min).
if (process.platform === 'darwin') {
    console.log('[pre-build] Building/verifying bundled ffmpeg (macOS, LGPL, universal)...');
    const ffmpegResult = spawnSync(BASH, [path.join(__dirname, 'build-ffmpeg-macos.sh')], {
        stdio: 'inherit',
        shell: false,
    });

    if (ffmpegResult.status !== 0) {
        console.error('');
        console.error('[pre-build] FAIL: no se pudo compilar/verificar el ffmpeg bundleado.');
        console.error('  Sin Contents/MacOS/ffmpeg la app no genera audio.mp4 (encode.rs /');
        console.error('  incremental_saver.rs) y la App Store rechaza la descarga en runtime (2.5.2).');
        console.error('  Revisa el log de configure/make en target/ffmpeg-macos/build-*/.');
        process.exit(1);
    }

    console.log('[pre-build] OK: bundled ffmpeg ready');
}

// Windows: ffmpeg LGPL prebuilt (BtbN, tag + SHA-256 pineados) como sidecar
// externalBin de tauri.windows.conf.json. Tiene que existir ANTES de que el
// bundler recoja externalBin: sin el, `tauri build` falla por binario ausente, y
// antes de #32 la app lo DESCARGABA en runtime (gyan.dev, 106 MB, GPLv3) dentro
// del primer checkpoint de 30 s. Idempotente por stamp: si ya esta al dia sale en
// milisegundos; la primera vez baja ~146 MB.
if (process.platform === 'win32') {
    console.log('[pre-build] Staging bundled ffmpeg (Windows, LGPL, prebuilt)...');
    const ffmpegWinResult = spawnSync(process.execPath, [path.join(__dirname, 'stage-ffmpeg-windows.js')], {
        stdio: 'inherit',
        shell: false,
    });

    if (ffmpegWinResult.status !== 0) {
        console.error('');
        console.error('[pre-build] FAIL: no se pudo stagear/verificar el ffmpeg bundleado de Windows.');
        console.error('  Sin binaries/ffmpeg-x86_64-pc-windows-msvc.exe el bundler de Tauri falla');
        console.error('  (externalBin declarado en tauri.windows.conf.json) y, si se saltara, la app');
        console.error('  volveria a descargar ffmpeg en runtime al primer checkpoint de 30 s.');
        console.error('  Regenerar: node scripts/stage-ffmpeg-windows.js --fix');
        process.exit(1);
    }

    console.log('[pre-build] OK: bundled ffmpeg (Windows) ready');
}

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
    console.error('  Restore the MARKER comment in src/app/(main)/layout.tsx, or update');
    console.error('  PROVIDER_INVARIANTS in src/app/(main)/layout.test.ts if intentional.');
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

// Manifiestos del workspace (#31 de la auditoría de recursos): Cargo ignora con un
// warning los [profile]/[patch] de los miembros — así vivieron 8 meses un LTO que
// nunca aplicó y un fork de cpal que nunca entró al binario. Parser de texto, <50 ms.
console.log('[pre-build] Running cargo-workspace lint...');
const cargoWorkspaceResult = spawnSync(process.execPath, [CARGO_WORKSPACE_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (cargoWorkspaceResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: cargo-workspace lint failed.');
    console.error('  Un miembro del workspace declara [profile]/[patch] (Cargo lo ignora), o el');
    console.error('  [profile.release] de la raíz perdió lto / panic="unwind" / ganó strip="symbols".');
    console.error('  Ver CLAUDE.md § "Plataformas y GPU" (#31) y docs/BUILDING.md.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: cargo-workspace lint passed');

// Una sola pila HTTP/TLS y cero deps muertas (#35 de la auditoría de recursos).
// Va antes de migraciones/helper: es `cargo tree` (~2-4 s) y falla con mensaje
// concreto si vuelve a entrar un rustls/reqwest/zip/dirs duplicado o aws-lc-rs.
console.log('[pre-build] Running cargo-deps lint...');
const cargoDepsResult = spawnSync(process.execPath, [CARGO_DEPS_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (cargoDepsResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: cargo-deps lint failed.');
    console.error('  El árbol de Cargo volvió a tener dos versiones de una crate de la pila');
    console.error('  HTTP/TLS (o de zip/dirs), o entró una crate prohibida (aws-lc-rs = segundo');
    console.error('  proveedor criptográfico → panic al primer HTTPS; clap/esaxx/symphonia = muertas).');
    console.error('  Ver CLAUDE.md § "Dependencias Rust: una sola pila TLS".');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: cargo-deps lint passed');

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
