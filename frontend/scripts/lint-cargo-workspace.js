#!/usr/bin/env node
// Lint del workspace de Cargo: hace ejecutable el cierre de #31 de la auditoría de
// recursos (docs/AUDITORIA_RECURSOS_2026-09-02.md).
//
// Por qué: Cargo SOLO honra `[profile.*]` y `[patch.*]` del manifiesto RAÍZ del
// workspace. Un bloque de esos en un miembro compila verde, imprime un warning que
// nadie lee ("profiles for the non root package will be ignored") y NO aplica.
// Así vivieron 8 meses el `[profile.release]` de llama-helper (LTO que nunca entró)
// y el `[patch.crates-io]` de cpal en src-tauri (un fork que nunca llegó a un
// binario). Ningún test de Rust puede detectarlo: sólo leer los manifiestos.
//
// Garantías (todas fallan el pre-build):
//   (a) ningún miembro de `[workspace].members` declara `[profile...]` ni
//       `[patch...]` en su Cargo.toml;
//   (b) la raíz declara `[profile.release]` con `lto` y sin `panic = "abort"`
//       (Sentry + telemetry/panics.rs necesitan unwind) ni `strip = "symbols"`
//       (en MSVC no encoge nada; en macOS/Linux deja los stack traces sin nombres);
//   (c) ningún `.cargo/config.toml` del repo declara `[profile...]`: un config
//       sobreescribe al manifiesto en silencio (cargo book § profiles).
//
// Parser de texto puro (sin cargo, <50 ms). Corre en run-pre-build-checks.js.
// Uso manual: node scripts/lint-cargo-workspace.js [--report]
// Escape hatch: pnpm run tauri:build:debug:skip-checks

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT_MANIFEST = path.join(REPO_ROOT, 'Cargo.toml');
const CARGO_CONFIGS = [
    path.join(REPO_ROOT, '.cargo', 'config.toml'),
    path.join(REPO_ROOT, '.cargo', 'config'),
    path.join(REPO_ROOT, 'frontend', 'src-tauri', '.cargo', 'config.toml'),
    path.join(REPO_ROOT, 'frontend', 'src-tauri', '.cargo', 'config'),
    path.join(REPO_ROOT, 'llama-helper', '.cargo', 'config.toml'),
];
const REPORT = process.argv.includes('--report');

// Cabecera de tabla TOML: `[profile.release]`, `[patch.crates-io]`, `[profile]`…
const SECTION_RE = /^\s*\[\s*([A-Za-z0-9_.-]+(?:\s*\.\s*"[^"]*")?)[^\]]*\]/;
// Línea `clave = valor` (sin comentario final). Sólo para claves simples.
const KV_RE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/;

function readLines(file) {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

/** Devuelve [{name, line}] de cada cabecera de sección del archivo. */
function sections(lines) {
    const out = [];
    lines.forEach((raw, i) => {
        const line = raw.replace(/#.*$/, '');
        const m = line.match(SECTION_RE);
        if (m) out.push({ name: m[1].replace(/\s+/g, ''), line: i + 1 });
    });
    return out;
}

/** Pares clave=valor (crudos) dentro de una sección concreta. */
function sectionValues(lines, sectionName) {
    const values = {};
    let inside = false;
    for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        const s = line.match(SECTION_RE);
        if (s) {
            inside = s[1].replace(/\s+/g, '') === sectionName;
            continue;
        }
        if (!inside) continue;
        const kv = line.match(KV_RE);
        if (kv) values[kv[1]] = kv[2].trim();
    }
    return values;
}

/** Miembros del `[workspace]` de la raíz (array `members = [...]`, mono o multilínea). */
function workspaceMembers(lines) {
    const text = lines.join('\n');
    const ws = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
    if (!ws) return [];
    return ws[1]
        .split(/[\n,]/)
        .map((s) => s.replace(/#.*$/, '').trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
}

const failures = [];
const report = [];

// (a) miembros sin [profile] ni [patch]
const rootLines = readLines(ROOT_MANIFEST);
const members = workspaceMembers(rootLines);
if (members.length === 0) {
    failures.push(`no se pudo leer [workspace].members de ${path.relative(REPO_ROOT, ROOT_MANIFEST)}`);
}
for (const member of members) {
    const manifest = path.join(REPO_ROOT, member, 'Cargo.toml');
    if (!fs.existsSync(manifest)) {
        failures.push(`miembro "${member}" sin Cargo.toml (${path.relative(REPO_ROOT, manifest)})`);
        continue;
    }
    const found = sections(readLines(manifest)).filter((s) => /^(profile|patch)(\.|$)/.test(s.name));
    report.push(`${path.relative(REPO_ROOT, manifest)}: ${found.length ? found.map((s) => `[${s.name}]@${s.line}`).join(', ') : 'sin [profile]/[patch] (ok)'}`);
    for (const s of found) {
        failures.push(
            `${path.relative(REPO_ROOT, manifest)}:${s.line} declara [${s.name}] en un MIEMBRO del workspace: ` +
            'Cargo lo ignora con un warning (no aplica). Moverlo al Cargo.toml de la raíz.'
        );
    }
}

// (b) raíz con [profile.release] sano
const rootSections = sections(rootLines);
const release = rootSections.find((s) => s.name === 'profile.release');
if (!release) {
    failures.push(`${path.relative(REPO_ROOT, ROOT_MANIFEST)}: falta [profile.release] (thin LTO + codegen-units=1 + panic="unwind", #31).`);
} else {
    const v = sectionValues(rootLines, 'profile.release');
    report.push(`Cargo.toml (raíz) [profile.release]@${release.line}: ${Object.entries(v).map(([k, val]) => `${k}=${val}`).join(', ')}`);
    if (v.lto === undefined) {
        failures.push('Cargo.toml (raíz) [profile.release]: falta `lto` (el objeto de #31 era activar LTO en ambos binarios).');
    }
    if (v.lto !== undefined && /^(false|"off")$/.test(v.lto)) {
        failures.push(`Cargo.toml (raíz) [profile.release]: lto = ${v.lto} desactiva el LTO que cierra #31.`);
    }
    if (v.panic !== undefined && v.panic !== '"unwind"') {
        failures.push(`Cargo.toml (raíz) [profile.release]: panic = ${v.panic}; Sentry y logging/telemetry/panics.rs exigen "unwind".`);
    }
    if (v.strip !== undefined && /^(true|"symbols")$/.test(v.strip)) {
        failures.push(`Cargo.toml (raíz) [profile.release]: strip = ${v.strip} deja los stack traces de Sentry sin nombres en macOS/Linux y no encoge el exe en MSVC (símbolos en .pdb).`);
    }
}

// (c) ningún .cargo/config con [profile]
for (const cfg of CARGO_CONFIGS) {
    if (!fs.existsSync(cfg)) continue;
    const found = sections(readLines(cfg)).filter((s) => /^profile(\.|$)/.test(s.name));
    report.push(`${path.relative(REPO_ROOT, cfg)}: ${found.length ? found.map((s) => `[${s.name}]@${s.line}`).join(', ') : 'sin [profile] (ok)'}`);
    for (const s of found) {
        failures.push(`${path.relative(REPO_ROOT, cfg)}:${s.line} declara [${s.name}]: un config de Cargo sobreescribe el perfil del manifiesto en silencio. Declararlo sólo en Cargo.toml (raíz).`);
    }
}

if (REPORT) {
    for (const line of report) console.log(`[lint-cargo-workspace] ${line}`);
}

if (failures.length > 0) {
    console.error('[lint-cargo-workspace] FAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    console.error('  Ver docs/BUILDING.md § "Perfil de release en la raíz" (#31) y CLAUDE.md § Plataformas y GPU.');
    process.exit(1);
}

console.log(`[lint-cargo-workspace] OK: ${members.length} miembros sin [profile]/[patch]; [profile.release] en la raíz con lto, panic=unwind, sin strip.`);
