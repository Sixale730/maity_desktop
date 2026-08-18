#!/usr/bin/env node
// Verifica la PROVENANCE del sidecar llama-helper que Tauri bundlea como
// externalBin (`frontend/src-tauri/binaries/llama-helper-<triple>[.exe]`).
//
// Por que: ese directorio esta gitignored y NADA lo construia ni verificaba en
// el build local — el `.exe` se copiaba a mano. Asi se embarcaron 3 MESES de
// helper stale (abr→jul 2026): el binario bundleado no hablaba el protocolo de
// ids, cada timeout mataba el proceso y recargaba 2.4 GB de modelo (el
// death-loop del coach). Ningun test unitario puede detectarlo: solo comparar
// el binario bundleado con lo que produce el codigo actual.
//
// Que hace: compila `cargo build -p llama-helper --release` (cacheado tras la
// primera vez; la primera compila llama.cpp, tarda minutos) y compara SHA-256
// del artefacto contra el bundleado. Mismatch o ausencia => exit 1 con la orden
// de copia. `--fix` copia el artefacto a binaries/ (y a msix_staging/ si existe)
// y re-verifica. `--report` solo imprime hashes.
//
// En CI (GITHUB_ACTIONS/CI) se SALTA: los workflows compilan el sidecar en su
// propio paso con features de plataforma (`--features vulkan` en Windows), asi
// que el hash de una compilacion sin features no coincidiria por diseno.
//
// Corre en run-pre-build-checks.js (debug + release) y en tauri:build:store.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BINARIES_DIR = path.join(REPO_ROOT, 'frontend', 'src-tauri', 'binaries');
const MSIX_STAGING = path.join(REPO_ROOT, 'msix_staging');
const args = new Set(process.argv.slice(2));
const FIX = args.has('--fix');
const REPORT = args.has('--report');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(lines) {
    console.error('[verify-helper] FAIL:');
    for (const l of lines) console.error(`  ${l}`);
    process.exit(1);
}

if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI) {
    console.log('[verify-helper] SKIP: en CI el workflow compila el sidecar en su propio paso (features de plataforma).');
    process.exit(0);
}

// 1. Triple del host (rustc -vV → "host: x86_64-pc-windows-msvc")
const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (rustc.status !== 0) {
    fail(['no se pudo ejecutar `rustc -vV` — ¿toolchain de Rust en PATH?']);
}
const hostLine = (rustc.stdout || '').split(/\r?\n/).find((l) => l.startsWith('host:'));
const triple = hostLine ? hostLine.slice('host:'.length).trim() : null;
if (!triple) fail(['`rustc -vV` no reporto `host:`.']);

const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const built = path.join(REPO_ROOT, 'target', 'release', `llama-helper${exeSuffix}`);
const bundled = path.join(BINARIES_DIR, `llama-helper-${triple}${exeSuffix}`);
const staged = path.join(MSIX_STAGING, `llama-helper${exeSuffix}`);

// 2. Compilar el helper (cargo no re-enlaza si nada cambio ⇒ hash estable)
console.log('[verify-helper] cargo build -p llama-helper --release ...');
const build = spawnSync('cargo', ['build', '-p', 'llama-helper', '--release'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
if (build.status !== 0) {
    fail(['`cargo build -p llama-helper --release` fallo. Corregir llama-helper/ antes de bundlear.']);
}
if (!fs.existsSync(built)) {
    fail([`cargo termino pero no existe ${path.relative(REPO_ROOT, built)}.`]);
}

const builtHash = sha256(built);

function copyArtifact() {
    fs.mkdirSync(BINARIES_DIR, { recursive: true });
    fs.copyFileSync(built, bundled);
    console.log(`[verify-helper] copiado → ${path.relative(REPO_ROOT, bundled)}`);
    if (fs.existsSync(MSIX_STAGING)) {
        fs.copyFileSync(built, staged);
        console.log(`[verify-helper] copiado → ${path.relative(REPO_ROOT, staged)}`);
    }
}

function verify() {
    const failures = [];
    if (!fs.existsSync(bundled)) {
        failures.push(`falta el bundleado ${path.relative(REPO_ROOT, bundled)}`);
    } else {
        const bundledHash = sha256(bundled);
        if (bundledHash !== builtHash) {
            failures.push(
                `${path.relative(REPO_ROOT, bundled)}: hash distinto al artefacto compilado.\n` +
                `    compilado : ${builtHash}\n` +
                `    bundleado : ${bundledHash}`
            );
        }
    }
    // El staging MSIX es opcional (solo existe tras /store-msix), pero si esta,
    // tiene que ser el mismo binario: la Store lo empaqueta desde ahi.
    if (fs.existsSync(staged)) {
        const stagedHash = sha256(staged);
        if (stagedHash !== builtHash) {
            failures.push(
                `${path.relative(REPO_ROOT, staged)}: hash distinto al artefacto compilado.\n` +
                `    compilado : ${builtHash}\n` +
                `    staged    : ${stagedHash}`
            );
        }
    }
    return failures;
}

if (REPORT) {
    console.log(`[verify-helper] triple    : ${triple}`);
    console.log(`[verify-helper] compilado : ${builtHash}  ${path.relative(REPO_ROOT, built)}`);
    console.log(`[verify-helper] bundleado : ${fs.existsSync(bundled) ? sha256(bundled) : '(ausente)'}  ${path.relative(REPO_ROOT, bundled)}`);
    if (fs.existsSync(staged)) console.log(`[verify-helper] staged    : ${sha256(staged)}  ${path.relative(REPO_ROOT, staged)}`);
    process.exit(0);
}

let failures = verify();
if (failures.length > 0 && FIX) {
    copyArtifact();
    failures = verify();
}

if (failures.length > 0) {
    fail([
        ...failures.map((f) => `- ${f}`),
        '',
        'El sidecar bundleado NO corresponde al codigo de llama-helper/ (o no existe).',
        'Asi se embarcaron 3 meses de helper stale (jul-2026). Regenerar con:',
        '    node scripts/verify-helper-binary.js --fix',
        `(copia target/release/llama-helper${exeSuffix} → src-tauri/binaries/llama-helper-${triple}${exeSuffix}`,
        ` y, si existe, → msix_staging/llama-helper${exeSuffix})`,
        'Escape hatch: pnpm run tauri:build:debug:skip-checks',
    ]);
}

console.log(`[verify-helper] OK: sidecar bundleado == artefacto compilado (${builtHash.slice(0, 12)}…, ${triple})`);
