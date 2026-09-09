#!/usr/bin/env node
// Lint del bundle de arranque de la ventana principal (#24 de la auditoría de recursos).
//
// Mide, sobre el `out/` recién generado por `next build`, cuánto JS ejecuta
// `out/index.html` (la home: primera pintura de la app tras el login) y falla
// si vuelve a entrar al arranque algo que hoy va diferido o que se borró:
//   (a) los bytes EJECUTADOS (scripts sin `nomodule`; el polyfill lleva
//       nomodule y WebView2 no lo ejecuta) no pasan del presupuesto;
//   (b) ningún chunk referido contiene marcadores de framer-motion (vive sólo
//       en el chunk dinámico de /registration), recharts (sólo tras
//       LazyCommunicationTrendChart), prosemirror/BlockNote (se borraron con
//       /meeting-details), three.js (LazyVoxelAvatar) ni pptxgenjs (export de
//       la minuta bajo demanda);
//   (c) ningún CSS enlazado por index.html declara @font-face: las fuentes de
//       next/font (Geist, Inter) se declaran en app/(main)/chat/page.tsx, no
//       en el root layout, así que sólo chat.html las carga.
//
// Línea base (09-sep-2026, antes de #24): 38 scripts, 1,842 KB total (1,733 KB
// ejecutados) con recharts (345 KB) y framer (111 KB) en el arranque y 60
// @font-face en el CSS. Después de #24: 32 scripts, 1,379 KB total, 1,269 KB
// ejecutados, 0 @font-face; recharts (342 KB) y framer (120 KB) quedan en chunks
// que ningún html referencia (lazy). Detalle: docs/UI_REGLAS.md § "Bundle de
// arranque". Presupuesto = medido + ~10 %.
//
// Env: MAITY_MAIN_BUNDLE_BUDGET_KB (default 1400), MAITY_MAIN_BUNDLE_SKIP=1.
// Corre en run-post-build-checks.js. Uso manual: node scripts/lint-main-bundle.js

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(FRONTEND_ROOT, 'out');
const HTML = 'index.html';
const BUDGET_KB = Number(process.env.MAITY_MAIN_BUNDLE_BUDGET_KB || 1400);
const MARKERS = [
    { name: 'framer-motion', re: /framerAppearId|data-framer-appear-id/ },
    { name: 'recharts', re: /recharts-(wrapper|surface)/ },
    { name: 'prosemirror/BlockNote', re: /ProseMirror/ },
    { name: 'three.js', re: /WebGLRenderer/ },
    { name: 'pptxgenjs', re: /PptxGenJS/ },
];

if (process.env.MAITY_MAIN_BUNDLE_SKIP === '1') {
    console.log('[lint-main-bundle] SKIP (MAITY_MAIN_BUNDLE_SKIP=1)');
    process.exit(0);
}

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

/** Hojas de estilo externas de un html: [href]. */
function stylesheetsOf(html) {
    const out = [];
    const re = /<link\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const attrs = m[1];
        if (!/\brel="stylesheet"/i.test(attrs)) continue;
        const href = /\bhref="([^"]+)"/i.exec(attrs);
        if (href) out.push(href[1]);
    }
    return out;
}

function assetPath(src) {
    return path.join(OUT_DIR, src.replace(/^\//, '').replace(/[?#].*$/, ''));
}

const htmlPath = path.join(OUT_DIR, HTML);
if (!fs.existsSync(htmlPath)) {
    console.error(`[lint-main-bundle] FAIL: out/${HTML} no existe (¿corrió next build?)`);
    process.exit(1);
}

const failures = [];
const html = fs.readFileSync(htmlPath, 'utf8');

let executed = 0;
let total = 0;
let count = 0;
for (const s of scriptsOf(html)) {
    const file = assetPath(s.src);
    if (!fs.existsSync(file)) {
        failures.push(`script ${s.src} no existe en out/`);
        continue;
    }
    const size = fs.statSync(file).size;
    total += size;
    count += 1;
    if (!s.noModule) executed += size;

    const content = fs.readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
        if (marker.re.test(content)) {
            failures.push(`el chunk ${path.basename(s.src)} (${Math.round(size / 1024)} KB) contiene ${marker.name}`);
        }
    }
}

let fontFaces = 0;
let cssCount = 0;
for (const href of stylesheetsOf(html)) {
    const file = assetPath(href);
    if (!fs.existsSync(file)) {
        failures.push(`stylesheet ${href} no existe en out/`);
        continue;
    }
    cssCount += 1;
    const n = (fs.readFileSync(file, 'utf8').match(/@font-face/g) || []).length;
    if (n > 0) {
        fontFaces += n;
        failures.push(`el CSS ${path.basename(href)} declara ${n} @font-face (next/font volvió al root layout)`);
    }
}

const executedKb = Math.round(executed / 1024);
console.log(`[lint-main-bundle] out/${HTML}: ${count} scripts, ${Math.round(total / 1024)} KB total, ${executedKb} KB ejecutados (presupuesto ${BUDGET_KB} KB); ${cssCount} CSS, ${fontFaces} @font-face`);
if (executedKb > BUDGET_KB) {
    failures.push(`${executedKb} KB ejecutados > presupuesto ${BUDGET_KB} KB`);
}

if (failures.length) {
    console.error('[lint-main-bundle] FAIL: el bundle de arranque de la main volvió a crecer.');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    console.error('  Reglas en docs/UI_REGLAS.md § "Bundle de arranque": framer-motion sólo bajo');
    console.error('  features/auth/**, recharts sólo vía LazyCommunicationTrendChart, librerías pesadas');
    console.error('  tras dynamic()/lazy, next/font sólo en la ruta que lo usa. Escape: MAITY_MAIN_BUNDLE_SKIP=1');
    process.exit(1);
}

console.log('[lint-main-bundle] OK: sin framer/recharts/prosemirror/three/pptx en el arranque, sin @font-face, dentro del presupuesto.');
