#!/usr/bin/env node
// Lint de ACL de Tauri: cruza lo que el código EJERCE (call sites que exigen
// permiso) contra lo que cada capability DECLARA en tauri.conf.json, POR VENTANA.
//
// Por qué: `core:window:default` no incluye `allow-destroy` ni `allow-close`,
// y `onCloseRequested()` de @tauri-apps/api llama `destroy()` AUTOMÁTICAMENTE
// cuando el handler no hace `preventDefault()`. Nadie llama `.destroy()` en
// nuestro código, así que nadie lo vio: 13 usuarias del piloto Dingler
// generaban `app.error` de ACL al cerrar la ventana (ago-2026). Igual con
// `window.confirm`/`alert`: el plugin dialog los intercepta globalmente y
// exige `dialog:allow-confirm`/`allow-message`.
//
// Cómo atribuye ventana a un archivo:
//   - `src/app/<aux>/page.tsx` + `layout.tsx` son las ENTRADAS de cada ventana
//     auxiliar (labels == rutas, ver lib/auxWindows.ts); se recorre el grafo de
//     imports (`@/…` y relativos) y todo archivo alcanzable se evalúa contra la
//     capability de esa ventana.
//   - TODO archivo se evalúa además contra `main`.
//   - Excepción documentada: `src/app/layout.tsx` (root) es solo-main — sus call
//     sites viven en `AppContent`, y RootLayout hace early-return para rutas aux
//     ANTES de montarlo (invariante en app/layout.test.ts).
//
// Tabla call → permiso (gate por import del archivo para evitar falsos positivos
// como AudioContext.close() o Chart.js .destroy()):
//   onCloseRequested(        → core:window:allow-destroy   (siempre: preventDefault condicional también destruye)
//   .close()  [importa api/window|webviewWindow] → core:window:allow-close
//   .destroy()[idem]         → core:window:allow-destroy
//   getVersion( [importa api/app] → core:app:default
//   confirm(                 → dialog:allow-confirm   (window.confirm o bare)
//   alert(                   → dialog:allow-message
//   ask( / message( [importa plugin-dialog] → dialog:allow-ask / dialog:allow-message
//
// Escape por línea: `// acl-allow: <razón>`. Excluidos: *.test.ts(x), shared/maity-shared/.
// Corre en run-pre-build-checks.js. Uso manual: node scripts/lint-tauri-acl.js [--report]

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(FRONTEND_ROOT, 'src');
const APP_DIR = path.join(SRC, 'app');
const TAURI_CONF = path.join(FRONTEND_ROOT, 'src-tauri', 'tauri.conf.json');
const AUX_WINDOWS_FILE = path.join(SRC, 'lib', 'auxWindows.ts');
const ROOT_LAYOUT = path.join(APP_DIR, 'layout.tsx');
const REPORT = process.argv.includes('--report');
const ALLOW_MARK = 'acl-allow:';

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function rel(file) {
    return path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
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

function isExcluded(file) {
    const r = rel(file);
    return r.endsWith('.test.ts') || r.endsWith('.test.tsx') || r.includes('src/shared/maity-shared/') || r.includes('src/test/');
}

// ── Capabilities por ventana ────────────────────────────────────────────────

const conf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'));
const capabilities = (((conf.app || {}).security || {}).capabilities) || [];
/** window label → Set(permissions) */
const permsByWindow = new Map();
for (const cap of capabilities) {
    const perms = new Set((cap.permissions || []).map((p) => (typeof p === 'string' ? p : p.identifier)));
    for (const w of cap.windows || []) {
        if (!permsByWindow.has(w)) permsByWindow.set(w, new Set());
        for (const p of perms) permsByWindow.get(w).add(p);
    }
}
if (!permsByWindow.has('main')) {
    console.error('[lint-tauri-acl] FAIL: tauri.conf.json no declara capability para la ventana `main`.');
    process.exit(1);
}

// ── Ventanas auxiliares (labels == rutas) ───────────────────────────────────

const auxSrc = fs.readFileSync(AUX_WINDOWS_FILE, 'utf8');
const auxArr = /AUX_WINDOW_PATHS\s*=\s*\[([^\]]*)\]/.exec(auxSrc);
if (!auxArr) {
    console.error('[lint-tauri-acl] FAIL: no se pudo leer AUX_WINDOW_PATHS de lib/auxWindows.ts');
    process.exit(1);
}
const auxLabels = [...auxArr[1].matchAll(/'\/([^']+)'/g)].map((m) => m[1]);
for (const label of auxLabels) {
    if (!permsByWindow.has(label)) {
        console.error(`[lint-tauri-acl] FAIL: la ventana aux "${label}" (lib/auxWindows.ts) no tiene capability en tauri.conf.json.`);
        process.exit(1);
    }
}

// ── Grafo de imports ────────────────────────────────────────────────────────

const IMPORT_RE = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTS = ['.ts', '.tsx'];

function resolveImport(fromFile, spec) {
    let base;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    else return null; // paquete externo
    const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

const importCache = new Map();
function importsOf(file) {
    if (importCache.has(file)) return importCache.get(file);
    const content = fs.readFileSync(file, 'utf8');
    const out = new Set();
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(content)) !== null) {
        const spec = m[1] || m[2];
        const resolved = resolveImport(file, spec);
        if (resolved) out.add(resolved);
    }
    importCache.set(file, out);
    return out;
}

/** Archivos alcanzables desde las entradas de una ventana aux. */
function reachableFrom(entries) {
    const seen = new Set();
    const stack = entries.filter((e) => fs.existsSync(e));
    while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        for (const dep of importsOf(f)) if (!seen.has(dep)) stack.push(dep);
    }
    // El root layout envuelve también a las páginas aux, pero hace early-return
    // antes de AppContent: es solo-main por invariante (layout.test.ts).
    seen.delete(ROOT_LAYOUT);
    return seen;
}

/** file → Set(window labels) — main siempre; aux si es alcanzable desde su entrada. */
const windowsOfFile = new Map();
const allFiles = walk(SRC, EXTS).filter((f) => !isExcluded(f));
for (const f of allFiles) windowsOfFile.set(f, new Set(['main']));
for (const label of auxLabels) {
    const entries = [path.join(APP_DIR, label, 'page.tsx'), path.join(APP_DIR, label, 'layout.tsx')];
    for (const f of reachableFrom(entries)) {
        if (!windowsOfFile.has(f)) continue;
        windowsOfFile.get(f).add(label);
    }
}

// ── Call sites que exigen permiso ───────────────────────────────────────────

const RULES = [
    { kind: 'onCloseRequested', re: /\bonCloseRequested\s*\(/g, perm: 'core:window:allow-destroy', gate: null },
    { kind: '.close()', re: /\.close\s*\(\s*\)/g, perm: 'core:window:allow-close', gate: /@tauri-apps\/api\/(window|webviewWindow)/ },
    { kind: '.destroy()', re: /\.destroy\s*\(\s*\)/g, perm: 'core:window:allow-destroy', gate: /@tauri-apps\/api\/(window|webviewWindow)/ },
    { kind: 'getVersion()', re: /\bgetVersion\s*\(/g, perm: 'core:app:default', gate: /@tauri-apps\/api\/app/ },
    { kind: 'confirm()', re: /(?<![\w.])(?:window\.)?confirm\s*\(/g, perm: 'dialog:allow-confirm', gate: null },
    { kind: 'alert()', re: /(?<![\w.])(?:window\.)?alert\s*\(/g, perm: 'dialog:allow-message', gate: null },
    { kind: 'ask()', re: /(?<![\w.])ask\s*\(/g, perm: 'dialog:allow-ask', gate: /@tauri-apps\/plugin-dialog/ },
    { kind: 'message()', re: /(?<![\w.])message\s*\(/g, perm: 'dialog:allow-message', gate: /@tauri-apps\/plugin-dialog/ },
];

const violations = [];
const inventory = [];
for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const rule of RULES) {
        if (rule.gate && !rule.gate.test(content)) continue;
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(content)) !== null) {
            const text = lineText(content, m.index);
            if (text.includes(ALLOW_MARK)) continue;
            // Comentarios/JSDoc que mencionan la API
            if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
            const line = lineOf(content, m.index);
            const windows = windowsOfFile.get(file);
            inventory.push({ file, line, kind: rule.kind, perm: rule.perm, windows: [...windows] });
            for (const w of windows) {
                if (!permsByWindow.get(w).has(rule.perm)) {
                    violations.push({ file, line, kind: rule.kind, perm: rule.perm, window: w });
                }
            }
        }
    }
}

if (REPORT) {
    console.log('[lint-tauri-acl] inventario de call sites que exigen permiso:');
    for (const i of inventory) {
        console.log(`  ${rel(i.file)}:${i.line}  ${i.kind.padEnd(18)} → ${i.perm.padEnd(28)} ventanas: ${i.windows.join(', ')}`);
    }
    process.exit(0);
}

if (violations.length) {
    console.error('[lint-tauri-acl] FAIL: el código ejerce permisos que la ACL no declara para esa ventana.');
    for (const v of violations) {
        console.error(`  ${rel(v.file)}:${v.line}  ${v.kind} exige "${v.perm}" en la capability de la ventana "${v.window}"`);
    }
    console.error('');
    console.error('  Declarar el permiso en app.security.capabilities de src-tauri/tauri.conf.json');
    console.error('  (la capability cuya `windows` incluye esa ventana), o mover el call site fuera');
    console.error('  del árbol de esa ventana. Escape por línea: // acl-allow: <razón>');
    console.error('  Recordar: onCloseRequested sin preventDefault() destruye la ventana → allow-destroy.');
    process.exit(1);
}

console.log(
    `[lint-tauri-acl] OK: ${inventory.length} call sites con permiso cubiertos por la ACL en ${permsByWindow.size} ventanas (${[...permsByWindow.keys()].join(', ')}).`
);
