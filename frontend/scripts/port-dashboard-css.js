#!/usr/bin/env node
/**
 * port-dashboard-css.js — CSS del dashboard de expedición portado de la web
 * (Sixale730/maity, src/features/dashboard/components/gamified-v2 + src/features/expedition).
 *
 * POR QUÉ: la web resuelve su layout con `@media (min/max-width)`. En el desktop
 * el DPI scaling de Windows (125 %/150 %) hace que el viewport que ve el webview
 * de Tauri caiga entre breakpoints y el dashboard colapsa a la versión móvil
 * (docs/UI_REGLAS.md § Dashboard). Además el ancho útil NO es el viewport: la
 * sidebar (w-16/w-64) se come parte. Por eso cada `@media` de ANCHO se convierte
 * en una container query contra el contenedor `dashboard`
 * (`container: dashboard / inline-size`, lo declara GamifiedDashboardV2).
 *
 * Mapeo (web → desktop), pensado para que una ventana de 1100 px con la sidebar
 * expandida (≈ 844 px útiles) siga viendo el layout "de escritorio":
 *   min-width:1100 → min-width:820     max-width:1099 → max-width:819
 *   max-width:767  → max-width:560     max-width:600  → max-width:440
 * Cualquier otro ancho es un error (hay que decidir su mapeo aquí, no a ojo).
 * Las media queries que no son de ancho (`prefers-reduced-motion`, …) no se tocan.
 *
 * Uso:
 *   node scripts/port-dashboard-css.js                 convierte en sitio (idempotente)
 *   node scripts/port-dashboard-css.js --check         exit 1 si queda algún @media de ancho
 *   node scripts/port-dashboard-css.js --from C:/maity re-copia desde el clon de la web y convierte
 *
 * El guard `src/features/dashboard/dashboard-guards.test.ts` corre la misma
 * verificación que `--check` en `pnpm test`.
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-console -- script de Node (CommonJS) como el resto de scripts/ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.resolve(__dirname, '..');
const WEB_ORIGIN = 'web Sixale730/maity@3ef2914';

const WIDTH_MAP = {
  'min-width:1100': 'min-width: 820px',
  'max-width:1099': 'max-width: 819px',
  'max-width:767': 'max-width: 560px',
  'max-width:600': 'max-width: 440px',
};

/**
 * Archivos portados. `web` = ruta relativa al repo web (solo para --from);
 * `copy: false` = otro dueño lo adaptó a mano (solo se convierte / verifica).
 * `dropLines` = reglas muertas en el desktop que se quitan al copiar.
 */
const FILES = [
  { dest: 'src/features/dashboard/components/gamified-v2/conversation-moments.css', web: 'src/features/dashboard/components/gamified-v2/conversation-moments.css' },
  {
    dest: 'src/features/dashboard/components/gamified-v2/dashboard-fit.css',
    web: 'src/features/dashboard/components/gamified-v2/dashboard-fit.css',
    // `.adventure-*` es la tarjeta de misión vieja de la web: no se renderiza en
    // el desktop y su fondo (`mountain-blue-concept-v1.png`, 2 MB) no se embarca.
    dropLines: /adventure-/,
    note: 'se quitan las reglas `.adventure-*` (tarjeta de misión vieja, sin uso; su fondo de 2 MB no se embarca)',
  },
  { dest: 'src/features/dashboard/components/gamified-v2/dashboard-unified.css', web: 'src/features/dashboard/components/gamified-v2/dashboard-unified.css' },
  { dest: 'src/features/dashboard/components/gamified-v2/expedition-pilot.css', web: 'src/features/dashboard/components/gamified-v2/expedition-pilot.css' },
  { dest: 'src/features/dashboard/components/gamified-v2/radar-palette.css', web: 'src/features/dashboard/components/gamified-v2/radar-palette.css' },
  { dest: 'src/features/dashboard/components/gamified-v2/dashboard-theme.css', copy: false },
  { dest: 'src/features/expedition/lava-boss.css', web: 'src/features/expedition/lava-boss.css' },
  { dest: 'src/features/expedition/expedition-visual-system.css', web: 'src/features/expedition/expedition-visual-system.css' },
  { dest: 'src/features/expedition/expedition-icons.css', copy: false },
];

const WIDTH_MEDIA = /@media\s*\(\s*(min|max)-width\s*:\s*(\d+)px\s*\)/g;
/** Cualquier @media que mencione un ancho (incluye combinaciones con `and`). */
const ANY_WIDTH_MEDIA = /@media[^{]*\b(min-|max-)?width\b[^{]*\{/g;

const COMMENT = /(\/\*[\s\S]*?\*\/)/;

/** Aplica `fn` solo al código, nunca dentro de comentarios (las cabeceras citan el @media original). */
function mapCode(css, fn) {
  return css.split(COMMENT).map((part) => (part.startsWith('/*') ? part : fn(part))).join('');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function convert(css, file) {
  const unknown = [];
  const out = mapCode(css, (code) => code.replace(WIDTH_MEDIA, (match, kind, px) => {
    const mapped = WIDTH_MAP[`${kind}-width:${px}`];
    if (!mapped) {
      unknown.push(match);
      return match;
    }
    return `@container dashboard (${mapped})`;
  }));
  const leftovers = [...stripComments(out).matchAll(ANY_WIDTH_MEDIA)].map((m) => m[0]);
  if (unknown.length || leftovers.length) {
    throw new Error(`${file}: @media de ancho sin mapeo → ${[...new Set([...unknown, ...leftovers])].join(' | ')}`);
  }
  return out;
}

function header(entry) {
  const extra = entry.note ? `\n   También ${entry.note}.` : '';
  return `/* Origen: ${WEB_ORIGIN} ${entry.web}\n   Adaptación desktop (scripts/port-dashboard-css.js): @media de ancho → @container dashboard\n   (1100→820, 1099→819, 767→560, 600→440; DPI de Windows, docs/UI_REGLAS.md).${extra}\n   NO editar a mano: re-copiar con \`node scripts/port-dashboard-css.js --from <clon web>\`. */\n`;
}

function widthMediaIn(file) {
  const css = stripComments(fs.readFileSync(file, 'utf8'));
  return [...css.matchAll(ANY_WIDTH_MEDIA)].map((m) => m[0]);
}

function main(argv) {
  const check = argv.includes('--check');
  const fromIdx = argv.indexOf('--from');
  const webRoot = fromIdx >= 0 ? argv[fromIdx + 1] : null;
  if (fromIdx >= 0 && !webRoot) throw new Error('--from requiere la ruta del clon de la web');

  let problems = 0;
  for (const entry of FILES) {
    const dest = path.join(FRONTEND, entry.dest);
    if (check) {
      if (!fs.existsSync(dest)) { console.error(`falta ${entry.dest}`); problems++; continue; }
      const left = widthMediaIn(dest);
      if (left.length) { console.error(`${entry.dest}: ${left.join(' | ')}`); problems++; }
      continue;
    }
    if (webRoot && entry.copy !== false) {
      let css = fs.readFileSync(path.join(webRoot, entry.web), 'utf8');
      if (entry.dropLines) css = css.split('\n').filter((l) => !entry.dropLines.test(l)).join('\n');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, header(entry) + convert(css, entry.dest).replace(/\s*$/, '\n'));
      console.log(`copiado + convertido ${entry.dest}`);
      continue;
    }
    if (!fs.existsSync(dest)) { console.error(`falta ${entry.dest}`); problems++; continue; }
    const css = fs.readFileSync(dest, 'utf8');
    const next = convert(css, entry.dest);
    if (next !== css) {
      fs.writeFileSync(dest, next);
      console.log(`convertido ${entry.dest}`);
    }
  }
  if (problems) {
    console.error(`port-dashboard-css: ${problems} archivo(s) con problemas`);
    process.exit(1);
  }
  if (check) console.log('port-dashboard-css: sin @media de ancho en el CSS portado');
}

module.exports = { convert, widthMediaIn, FILES, WIDTH_MAP };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(2);
  }
}
