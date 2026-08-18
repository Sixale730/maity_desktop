#!/usr/bin/env node
// Lint de telemetría: hace ejecutable el contrato de docs/TELEMETRIA.md.
//
// Garantías (todas fallan el pre-build):
//   (a) single writer — el RPC `insert_platform_log` solo se invoca desde
//       src/lib/platformLogger.ts (JS) y src-tauri/.../telemetry/drain.rs (Rust).
//       Dos drenadores = filas duplicadas (pasó con syncToCloud(), ago-2026).
//   (b) catálogo espejo — src/lib/telemetry-events.ts y catalog.rs tienen el
//       MISMO conjunto de nombres, y el MISMO subconjunto marcado `// legacy`.
//   (c) naming — todo nombre sin punto debe ir marcado `// legacy` (los eventos
//       nuevos son dot-namespaced; los recording_* históricos NO se renombran:
//       rompería la serie en maity.platform_logs).
//   (d) versión honesta — prohibido 'unknown' en campos de versión: un centinela
//       ordena por encima de '0.2.56' en max() y esconde el NULL real.
//   (e) ACL — toda capability de tauri.conf.json incluye core:app:default (sin
//       él getVersion() es rechazado y la ventana reporta versión vacía).
//   (f) inventario — todo nombre del catálogo aparece con backticks en
//       docs/TELEMETRIA.md (evento nuevo = 3 entradas: TS, Rust, doc).
//   (g) call sites — platformLogger.log( / recordingLogService.log( con primer
//       argumento literal ⇒ el literal está catalogado; no-literal ⇒ violación.
//       Sin esto el catálogo y el doc se desactualizan al primer evento nuevo.
//
// Escape por línea: `// telemetry-allow: <razón>` (solo checks a, d, g).
// Excluidos: *.test.ts(x) y src/shared/maity-shared/** (árbol copiado de la web).
//
// Corre en run-pre-build-checks.js. Uso manual: node scripts/lint-telemetry.js

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');
const TS_ROOT = path.join(FRONTEND_ROOT, 'src');
const RUST_ROOT = path.join(FRONTEND_ROOT, 'src-tauri', 'src');
const RUST_CATALOG = path.join(RUST_ROOT, 'logging', 'telemetry', 'catalog.rs');
const TS_CATALOG = path.join(TS_ROOT, 'lib', 'telemetry-events.ts');
const TAURI_CONF = path.join(FRONTEND_ROOT, 'src-tauri', 'tauri.conf.json');
const DOC = path.join(REPO_ROOT, 'docs', 'TELEMETRIA.md');

const ALLOWED_WRITERS = new Set([
    path.join(TS_ROOT, 'lib', 'platformLogger.ts'),
    path.join(RUST_ROOT, 'logging', 'telemetry', 'drain.rs'),
]);

const ALLOW_MARK = 'telemetry-allow:';

// ── Helpers (patrón de lint-tauri-events.js) ────────────────────────────────

function walk(dir, exts, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (['node_modules', 'target', '.next', 'gen'].includes(entry.name)) continue;
            walk(full, exts, out);
        } else if (exts.some((e) => entry.name.endsWith(e))) {
            out.push(full);
        }
    }
    return out;
}

function lineOf(content, index) {
    return content.slice(0, index).split('\n').length;
}

function lineText(content, index) {
    const start = content.lastIndexOf('\n', index) + 1;
    let end = content.indexOf('\n', index);
    if (end === -1) end = content.length;
    return content.slice(start, end);
}

function lineHasAllow(content, index) {
    return lineText(content, index).includes(ALLOW_MARK);
}

function rel(file) {
    return path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
}

function isExcludedTs(file) {
    const r = rel(file);
    return (
        r.endsWith('.test.ts') ||
        r.endsWith('.test.tsx') ||
        r.includes('src/shared/maity-shared/') ||
        r.includes('src/test/')
    );
}

/** {name -> legacy:boolean} */
function parseRustCatalog() {
    if (!fs.existsSync(RUST_CATALOG)) return null;
    const content = fs.readFileSync(RUST_CATALOG, 'utf8');
    const map = new Map();
    const re = /pub const \w+: &str = "([^"]+)";([^\n]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) map.set(m[1], /\/\/\s*legacy\b/.test(m[2]));
    return map;
}

function parseTsCatalog() {
    if (!fs.existsSync(TS_CATALOG)) return null;
    const content = fs.readFileSync(TS_CATALOG, 'utf8');
    const map = new Map();
    const re = /\w+:\s*'([^']+)',([^\n]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) map.set(m[1], /\/\/\s*legacy\b/.test(m[2]));
    return map;
}

// ── Main ────────────────────────────────────────────────────────────────────

let failed = false;
function fail(header, lines) {
    failed = true;
    console.error(`[lint-telemetry] FAIL: ${header}`);
    for (const l of lines) console.error(`  ${l}`);
}

const tsFiles = walk(TS_ROOT, ['.ts', '.tsx']).filter((f) => !isExcludedTs(f));
const rustFiles = walk(RUST_ROOT, ['.rs']);

// (a) single writer
{
    const violations = [];
    const TS_RPC = /\.rpc\(\s*['"]insert_platform_log['"]/g;
    const RS_RPC = /rpc\/insert_platform_log|"insert_platform_log"/g;
    for (const [files, re] of [[tsFiles, TS_RPC], [rustFiles, RS_RPC]]) {
        for (const file of files) {
            if (ALLOWED_WRITERS.has(file)) continue;
            const content = fs.readFileSync(file, 'utf8');
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(content)) !== null) {
                if (lineHasAllow(content, m.index)) continue;
                violations.push(`${rel(file)}:${lineOf(content, m.index)}`);
            }
        }
    }
    if (violations.length) {
        fail('insert_platform_log fuera de los writers permitidos (single writer).', [
            ...violations.map((v) => `- ${v}`),
            'Escribe via platformLogger.log() (JS) o telemetry::emit (Rust → outbox → drain.rs).',
        ]);
    }
}

// (b) + (c) catálogo espejo y naming
const rustCat = parseRustCatalog();
const tsCat = parseTsCatalog();
if (!rustCat || !tsCat) {
    fail('falta catalog.rs o telemetry-events.ts', [rel(RUST_CATALOG), rel(TS_CATALOG)]);
} else {
    const onlyRust = [...rustCat.keys()].filter((v) => !tsCat.has(v));
    const onlyTs = [...tsCat.keys()].filter((v) => !rustCat.has(v));
    if (onlyRust.length || onlyTs.length) {
        fail('el catálogo Rust <-> TS divergió.', [
            ...onlyRust.map((v) => `solo en catalog.rs:          "${v}"`),
            ...onlyTs.map((v) => `solo en telemetry-events.ts: "${v}"`),
        ]);
    }
    const legacyMismatch = [...rustCat.keys()].filter(
        (v) => tsCat.has(v) && rustCat.get(v) !== tsCat.get(v)
    );
    if (legacyMismatch.length) {
        fail('marcador `// legacy` inconsistente entre catálogos.', legacyMismatch.map((v) => `"${v}"`));
    }
    const badNaming = [];
    for (const [cat, label] of [[rustCat, 'catalog.rs'], [tsCat, 'telemetry-events.ts']]) {
        for (const [name, legacy] of cat) {
            if (!name.includes('.') && !legacy) badNaming.push(`${label}: "${name}"`);
        }
    }
    if (badNaming.length) {
        fail('evento nuevo sin dot-namespacing (p.ej. `app.error`, `device.profile`).', [
            ...badNaming,
            'Los nombres snake_case históricos llevan `// legacy` y NO se renombran.',
        ]);
    }
}

// (d) 'unknown' en campos de versión
{
    const violations = [];
    const RE = /['"]unknown['"]/g;
    const scan = [...tsFiles, ...rustFiles.filter((f) => f.includes(path.join('logging', 'telemetry')))];
    for (const file of scan) {
        const content = fs.readFileSync(file, 'utf8');
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(content)) !== null) {
            const text = lineText(content, m.index);
            if (!/version/i.test(text)) continue;
            if (text.includes(ALLOW_MARK)) continue;
            // Comentarios que explican por qué NO se usa 'unknown' (líneas // o *)
            if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
            violations.push(`${rel(file)}:${lineOf(content, m.index)}  ${text.trim()}`);
        }
    }
    if (violations.length) {
        fail("'unknown' en un campo de versión (usar null u omitir la clave).", violations.map((v) => `- ${v}`));
    }
}

// (e) capabilities con core:app:default
{
    const conf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'));
    const caps = (((conf.app || {}).security || {}).capabilities) || [];
    const missing = caps
        .filter((c) => !(c.permissions || []).includes('core:app:default'))
        .map((c) => c.identifier);
    if (missing.length) {
        fail('capabilities sin core:app:default (getVersion() rechazado por ACL → app_version vacío).', missing);
    }
}

// (f) inventario en docs/TELEMETRIA.md
if (rustCat) {
    const doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
    const missing = [...rustCat.keys()].filter((name) => !doc.includes(`\`${name}\``));
    if (missing.length) {
        fail('eventos del catálogo sin fila en docs/TELEMETRIA.md (con backticks).', missing.map((v) => `\`${v}\``));
    }
}

// (g) call sites catalogados
if (rustCat) {
    const violations = [];
    // platformLogger.log( 'x' | recordingLogService.log( 'x' — multilínea; primer arg
    const CALL = /\b(platformLogger|recordingLogService)\s*\.\s*log\s*\(\s*([^\s)][^,)]*)/g;
    for (const file of tsFiles) {
        if (ALLOWED_WRITERS.has(file)) continue; // la definición del método
        const content = fs.readFileSync(file, 'utf8');
        CALL.lastIndex = 0;
        let m;
        while ((m = CALL.exec(content)) !== null) {
            const arg = m[2].trim();
            const lit = /^['"]([^'"]+)['"]$/.exec(arg);
            // El escape puede ir en la línea de la llamada o en la del argumento
            const argIndex = m.index + m[0].indexOf(m[2]);
            if (lineHasAllow(content, m.index) || lineHasAllow(content, argIndex)) continue;
            if (!lit) {
                violations.push(`${rel(file)}:${lineOf(content, argIndex)}  argumento no literal: ${arg}`);
            } else if (!rustCat.has(lit[1])) {
                violations.push(`${rel(file)}:${lineOf(content, argIndex)}  "${lit[1]}" no está en el catálogo`);
            }
        }
    }
    if (violations.length) {
        fail('call sites de telemetría fuera del catálogo.', [
            ...violations.map((v) => `- ${v}`),
            'Evento nuevo = 3 entradas: lib/telemetry-events.ts, catalog.rs y fila en docs/TELEMETRIA.md.',
        ]);
    }
}

if (failed) {
    console.error('');
    console.error('  Escape por línea (solo a/d/g): // telemetry-allow: <razón>');
    process.exit(1);
}

console.log(
    `[lint-telemetry] OK: catálogo espejo (${rustCat.size} eventos, ${[...rustCat.values()].filter(Boolean).length} legacy), single writer, versión honesta, ACL y doc en orden.`
);
