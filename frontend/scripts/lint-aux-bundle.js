#!/usr/bin/env node
// Lint del bundle de las ventanas auxiliares (#23 de la auditoría de recursos).
//
// Mide, sobre el `out/` recién generado por `next build`, cuánto JS carga cada
// ventana aux (`out/<label>.html`, labels de lib/auxWindows.ts) y falla si
// vuelve a arrastrar el grafo de la ventana principal:
//   (a) ningún <script> apunta a un chunk del grupo `(main)` ni a un
//       `app/layout-*.js` de nivel superior (route groups deshechos);
//   (b) ningún chunk referido contiene sonner (`data-sonner-toaster`) ni
//       supabase-js (`gotrue`): son marcadores de que el layout de la main
//       o platformLogger volvieron a entrar al grafo aux;
//   (c) los bytes EJECUTADOS (scripts sin `nomodule`; el polyfill de 112 KB
//       lleva nomodule y WebView2 no lo ejecuta) no pasan del presupuesto.
//
// Línea base (sep-2026): coach-float 1,172 KB → ~350 KB; recording-widget
// 1,158 → ~333 KB; device-picker 1,137 → ~312 KB. El piso (~297 KB) son
// react-dom + el runtime del App Router, compartidos con la main.
//
// Env: MAITY_AUX_BUNDLE_BUDGET_KB (default 450), MAITY_AUX_BUNDLE_SKIP=1.
// Corre en run-post-build-checks.js. Uso manual: node scripts/lint-aux-bundle.js

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(FRONTEND_ROOT, 'out');
const AUX_WINDOWS_FILE = path.join(FRONTEND_ROOT, 'src', 'lib', 'auxWindows.ts');
const BUDGET_KB = Number(process.env.MAITY_AUX_BUNDLE_BUDGET_KB || 450);
const MARKERS = [
    { name: 'sonner', re: /data-sonner-toaster/ },
    { name: 'supabase-js', re: /gotrue/ },
];

if (process.env.MAITY_AUX_BUNDLE_SKIP === '1') {
    console.log('[lint-aux-bundle] SKIP (MAITY_AUX_BUNDLE_SKIP=1)');
    process.exit(0);
}

const auxSrc = fs.readFileSync(AUX_WINDOWS_FILE, 'utf8');
const auxArr = /AUX_WINDOW_PATHS\s*=\s*\[([^\]]*)\]/.exec(auxSrc);
if (!auxArr) {
    console.error('[lint-aux-bundle] FAIL: no se pudo leer AUX_WINDOW_PATHS de lib/auxWindows.ts');
    process.exit(1);
}
const labels = [...auxArr[1].matchAll(/'\/([^']+)'/g)].map((m) => m[1]);

/** Scripts externos de un html: [{ src, noModule }]. */
function scriptsOf(html) {
    const out = [];
    const re = /<script\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const attrs = m[1];
        const src = /\bsrc="([^"]+)"/i.exec(attrs);
        if (!src) continue;
        out.push({ src: src[1], noModule: /\bnomodule\b/i.test(attrs) });
    }
    return out;
}

function chunkPath(src) {
    return path.join(OUT_DIR, src.replace(/^\//, '').replace(/[?#].*$/, ''));
}

const failures = [];
const rows = [];
for (const label of labels) {
    const htmlPath = path.join(OUT_DIR, `${label}.html`);
    if (!fs.existsSync(htmlPath)) {
        failures.push(`out/${label}.html no existe (¿la ruta aux dejó de exportarse?)`);
        continue;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scripts = scriptsOf(html);
    let executed = 0;
    let total = 0;
    let count = 0;
    for (const s of scripts) {
        const file = chunkPath(s.src);
        if (!fs.existsSync(file)) {
            failures.push(`${label}: script ${s.src} no existe en out/`);
            continue;
        }
        const size = fs.statSync(file).size;
        total += size;
        count += 1;
        if (!s.noModule) executed += size;

        if (/\/app\/\(main\)\//.test(s.src) || /\/app\/layout-[^/]*\.js/.test(s.src)) {
            failures.push(`${label}: carga un chunk del layout de la main: ${s.src}`);
        }
        const content = fs.readFileSync(file, 'utf8');
        for (const marker of MARKERS) {
            if (marker.re.test(content)) {
                failures.push(`${label}: el chunk ${path.basename(s.src)} contiene ${marker.name}`);
            }
        }
    }
    const executedKb = Math.round(executed / 1024);
    rows.push({ label, count, totalKb: Math.round(total / 1024), executedKb });
    if (executedKb > BUDGET_KB) {
        failures.push(`${label}: ${executedKb} KB ejecutados > presupuesto ${BUDGET_KB} KB`);
    }
}

console.log('[lint-aux-bundle] JS por ventana auxiliar (bytes ejecutados = scripts sin nomodule):');
for (const r of rows) {
    console.log(`  ${r.label.padEnd(18)} ${String(r.count).padStart(2)} scripts  ${String(r.totalKb).padStart(5)} KB total  ${String(r.executedKb).padStart(5)} KB ejecutados  (presupuesto ${BUDGET_KB} KB)`);
}

if (failures.length) {
    console.error('[lint-aux-bundle] FAIL: una ventana auxiliar volvió a cargar el grafo de la main.');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    console.error('  Las rutas aux viven en src/app/(aux) con su propio root layout; ese layout y sus');
    console.error('  páginas no deben importar supabase/platformLogger/analytics/contexts ni sonner.');
    console.error('  El test src/app/(aux)/layout.test.ts señala el import culpable. Escape: MAITY_AUX_BUNDLE_SKIP=1');
    process.exit(1);
}

console.log('[lint-aux-bundle] OK: sin chunks de (main), sin sonner/supabase, dentro del presupuesto.');
