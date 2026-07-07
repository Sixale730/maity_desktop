#!/usr/bin/env node
// Lint de eventos Tauri (WS4). Dos garantías:
//   (a) El espejo Rust <-> TS no puede divergir: el set de strings de
//       `src-tauri/src/events.rs` debe ser IDENTICO al de `src/lib/tauri-events.ts`.
//   (b) Ningún call site de emit/emit_to/listen/once puede usar un string
//       literal inline — debe usar las constantes. Previene la reintroducción
//       de strings duplicados a mano (90 eventos, 4 listeners huérfanos y un
//       typo `transcript-error` vs `transcription-error` en jul-2026).
//
// Escape hatch por línea: `// event-allow: <razón>` (Rust y TS).
// Modo inventario: `node lint-tauri-events.js --report` lista todos los
// literales de eventos encontrados (usado para construir events.rs).

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const RUST_ROOT = path.join(FRONTEND_ROOT, 'src-tauri', 'src');
const TS_ROOT = path.join(FRONTEND_ROOT, 'src');
const RUST_EVENTS_FILE = path.join(RUST_ROOT, 'events.rs');
const TS_EVENTS_FILE = path.join(TS_ROOT, 'lib', 'tauri-events.ts');

const REPORT_MODE = process.argv.includes('--report');

// ── Recolección de archivos ─────────────────────────────────────────────────

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

// ── Extracción de call sites con literal ────────────────────────────────────
// Los emit() del repo son mayormente multilínea (el string va en la línea
// siguiente), por eso los regex permiten \s* con saltos de línea.

// .emit("x") / .emit(\n "x" / listen("x") / once("x")
const CALL_WITH_LITERAL =
    /\.?\b(emit|listen|once)\s*(?:::<[^>]*>|<[^>]*>)?\s*\(\s*(['"])([^'"\n]+)\2/g;
// .emit_to("window", "event") / emitTo('window', 'event') — el evento es el 2º arg
const EMIT_TO_WITH_LITERAL =
    /\b(emit_to|emitTo)\s*\(\s*(['"])[^'"\n]*\2\s*,\s*(['"])([^'"\n]+)\3/g;

function lineOf(content, index) {
    return content.slice(0, index).split('\n').length;
}

function lineHasAllow(content, index) {
    const start = content.lastIndexOf('\n', index) + 1;
    let end = content.indexOf('\n', index);
    if (end === -1) end = content.length;
    return content.slice(start, end).includes('event-allow:');
}

/** Extrae [{event, file, line, kind}] de un archivo. */
function extractCallSites(file) {
    const content = fs.readFileSync(file, 'utf8');
    const sites = [];
    for (const re of [CALL_WITH_LITERAL, EMIT_TO_WITH_LITERAL]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) !== null) {
            const isEmitTo = re === EMIT_TO_WITH_LITERAL;
            const kind = isEmitTo ? 'emit_to' : m[1];
            const event = isEmitTo ? m[4] : m[3];
            if (lineHasAllow(content, m.index)) continue;
            sites.push({ event, file, line: lineOf(content, m.index), kind });
        }
    }
    return sites;
}

// ── Parseo de los archivos de constantes ────────────────────────────────────

function parseRustEvents() {
    if (!fs.existsSync(RUST_EVENTS_FILE)) return null;
    const content = fs.readFileSync(RUST_EVENTS_FILE, 'utf8');
    const values = new Set();
    const re = /pub const \w+: &str = "([^"]+)";/g;
    let m;
    while ((m = re.exec(content)) !== null) values.add(m[1]);
    return values;
}

function parseTsEvents() {
    if (!fs.existsSync(TS_EVENTS_FILE)) return null;
    const content = fs.readFileSync(TS_EVENTS_FILE, 'utf8');
    const values = new Set();
    const re = /\w+:\s*'([^']+)',/g;
    let m;
    while ((m = re.exec(content)) !== null) values.add(m[1]);
    return values;
}

// ── Main ────────────────────────────────────────────────────────────────────

const rustFiles = walk(RUST_ROOT, ['.rs']).filter((f) => f !== RUST_EVENTS_FILE);
const tsFiles = walk(TS_ROOT, ['.ts', '.tsx']).filter(
    (f) => f !== TS_EVENTS_FILE && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
);

const rustSites = rustFiles.flatMap(extractCallSites);
const tsSites = tsFiles.flatMap(extractCallSites);

if (REPORT_MODE) {
    const byEvent = new Map();
    for (const s of [...rustSites, ...tsSites]) {
        if (!byEvent.has(s.event)) byEvent.set(s.event, []);
        byEvent.get(s.event).push(s);
    }
    const events = [...byEvent.keys()].sort();
    console.log(`# ${events.length} eventos únicos con literal inline\n`);
    for (const ev of events) {
        const sites = byEvent.get(ev);
        const rust = sites.filter((s) => s.file.endsWith('.rs')).length;
        const ts = sites.length - rust;
        console.log(`${ev}  [rust:${rust} ts:${ts}]`);
        for (const s of sites) {
            console.log(`    ${path.relative(FRONTEND_ROOT, s.file)}:${s.line} (${s.kind})`);
        }
    }
    process.exit(0);
}

let failed = false;

// (a) Espejo sincronizado
const rustSet = parseRustEvents();
const tsSet = parseTsEvents();
if (!rustSet || !tsSet) {
    console.error('[lint-tauri-events] FAIL: falta events.rs o tauri-events.ts');
    process.exit(1);
}
const onlyRust = [...rustSet].filter((v) => !tsSet.has(v));
const onlyTs = [...tsSet].filter((v) => !rustSet.has(v));
if (onlyRust.length || onlyTs.length) {
    failed = true;
    console.error('[lint-tauri-events] FAIL: el espejo Rust <-> TS divergió.');
    for (const v of onlyRust) console.error(`  solo en events.rs:      "${v}"`);
    for (const v of onlyTs) console.error(`  solo en tauri-events.ts: "${v}"`);
}

// (b) Sin literales inline en call sites
const violations = [...rustSites, ...tsSites];
if (violations.length) {
    failed = true;
    console.error(
        `[lint-tauri-events] FAIL: ${violations.length} call site(s) con string literal inline.`,
    );
    console.error('  Usar las constantes de events.rs / tauri-events.ts, o anotar');
    console.error('  la línea con `// event-allow: <razón>` si es intencional.');
    for (const s of violations) {
        console.error(
            `  ${path.relative(FRONTEND_ROOT, s.file)}:${s.line} ${s.kind}("${s.event}")`,
        );
    }
}

if (failed) process.exit(1);
console.log(
    `[lint-tauri-events] OK: espejo sincronizado (${rustSet.size} eventos), sin literales inline.`,
);
