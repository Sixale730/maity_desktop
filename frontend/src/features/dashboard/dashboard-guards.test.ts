/**
 * Guardas del dashboard de expedición (port web Sixale730/maity@3ef2914, sep-2026).
 * Reglas en docs/UI_REGLAS.md § Dashboard:
 *
 *   1. El grafo ESTÁTICO de imports de GamifiedDashboardV2 (entra al home en el arranque)
 *      no alcanza recharts / three / @react-three / framer-motion (#24). Las gráficas van por
 *      `LazyCommunicationTrendChart` / `LazyProgressChartsSection` (`import()` dinámico).
 *   2. El CSS portado no tiene `@media` de ANCHO: se convierte a `@container dashboard`
 *      (scripts/port-dashboard-css.js) — el DPI de Windows rompe los breakpoints de viewport.
 *      Y el root del dashboard declara ese contenedor.
 *   3. Sin breakpoints Tailwind (`sm:`/`md:`/`lg:`/`xl:`) en los componentes del dashboard.
 *   4. Todo `/assets/...` que referencian (CSS `url()`, `src`, `gearAsset`) existe en public/.
 *   5. Nadie llama al RPC `get_user_learning_path` (PGRST202 en prod): `useLearningPath` es stub.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIMBING_GEAR_IDS, COSMETIC_REWARDS, gearAsset } from '@maity/shared';

const DASHBOARD = __dirname; // src/features/dashboard
const SRC = path.resolve(DASHBOARD, '..', '..'); // src
const FRONTEND = path.resolve(SRC, '..');
const PUBLIC = path.join(FRONTEND, 'public');
const EXPEDITION = path.join(SRC, 'features', 'expedition');
const ENTRY = path.join(DASHBOARD, 'components', 'gamified-v2', 'GamifiedDashboardV2.tsx');

function rel(file: string) {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

function walk(dir: string, filter: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

// Espejo de los `paths` de tsconfig.json para los imports copiados de la web.
const ALIASES: Record<string, string> = {
  '@/features/omi/services/omi.service': 'features/dashboard/adapters/omi.service.ts',
  '@/features/omi/utils/feedback-scores': 'features/dashboard/adapters/feedback-scores.ts',
  '@/features/omi/components/analysis/dashboard-v1/adapter': 'features/conversations/components/analysis/dashboard-v1/adapter.ts',
  '@maity/shared': 'shared/maity-shared.ts',
};
const EXTS = ['.ts', '.tsx'];
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (ALIASES[spec]) return path.join(SRC, ALIASES[spec]);
  if (spec.startsWith('@/ui/components/ui/')) base = path.join(SRC, 'components', 'ui', spec.slice('@/ui/components/ui/'.length));
  else if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

// Solo imports ESTÁTICOS (los `import()` de next/dynamic se cargan bajo demanda). `import type` se ignora.
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function staticGraph(entry: string) {
  const files = new Map<string, string>();
  const externals = new Map<string, string>();
  const stack: Array<[string, string]> = [[entry, '<entry>']];
  while (stack.length) {
    const [file, from] = stack.pop()!;
    if (files.has(file)) continue;
    files.set(file, from);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    STATIC_IMPORT_RE.lastIndex = 0;
    while ((m = STATIC_IMPORT_RE.exec(content)) !== null) {
      if (/^\s*(import|export)\s+type\b/.test(m[0].trimStart())) continue;
      const spec = m[1];
      const resolved = resolveImport(file, spec);
      if (resolved) { if (!files.has(resolved)) stack.push([resolved, file]); }
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) { if (!externals.has(spec)) externals.set(spec, file); }
    }
  }
  return { files, externals };
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('dashboard de expedición — guardas de bundle, DPI y assets', () => {
  it('el grafo estático del dashboard no alcanza recharts/three/@react-three/framer-motion', () => {
    const { files, externals } = staticGraph(ENTRY);
    const heavy = [...externals.entries()]
      .filter(([spec]) => /^(recharts|three|@react-three\/|framer-motion)(\/|$)/.test(spec))
      .map(([spec, from]) => `${spec} (importado desde ${rel(from)})`);
    expect(heavy, 'librería pesada en el arranque del home: cárgala con next/dynamic (molde LazyCommunicationTrendChart)').toEqual([]);
    const reached = [...files.keys()].map(rel);
    expect(reached).not.toContain('features/dashboard/components/gamified-v2/ProgressChartsSection.tsx');
    expect(reached).not.toContain('features/gamification/components/CommunicationTrendChart.tsx');
    // Y sí alcanza los wrappers diferidos (si alguien los quita, el test pierde sentido).
    expect(reached).toContain('features/dashboard/components/gamified-v2/LazyProgressChartsSection.tsx');
    expect(reached).toContain('features/gamification/components/LazyCommunicationTrendChart.tsx');
  });

  it('el CSS portado no usa @media de ancho y el root declara el contenedor `dashboard`', () => {
    const css = [...walk(DASHBOARD, (f) => f.endsWith('.css')), ...walk(EXPEDITION, (f) => f.endsWith('.css'))];
    expect(css.length).toBeGreaterThan(5);
    const offenders = css.flatMap((file) =>
      [...stripComments(readFileSync(file, 'utf8')).matchAll(/@media[^{]*\bwidth\b[^{]*\{/g)].map((m) => `${rel(file)}: ${m[0]}`));
    expect(offenders, 'convierte con `node scripts/port-dashboard-css.js`').toEqual([]);
    const desktopCss = readFileSync(path.join(DASHBOARD, 'components', 'gamified-v2', 'dashboard-desktop.css'), 'utf8');
    expect(desktopCss).toMatch(/\.maity-home-dashboard\s*\{[^}]*container:\s*dashboard\s*\/\s*inline-size/);
    expect(readFileSync(ENTRY, 'utf8')).toContain('maity-home-dashboard');
  });

  it('sin breakpoints de viewport de Tailwind en los componentes del dashboard', () => {
    const tsx = [...walk(DASHBOARD, (f) => f.endsWith('.tsx') && !f.includes('.test.')), ...walk(EXPEDITION, (f) => f.endsWith('.tsx'))];
    const offenders = tsx.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/["'`\s](?:sm|md|lg|xl|2xl):[a-z-[]/g)].map((m) => `${rel(file)}: ${m[0].trim()}`));
    expect(offenders, 'usa container queries (@container dashboard), no md:/lg: — DPI de Windows').toEqual([]);
  });

  it('todo /assets/... referenciado existe en public/', () => {
    const sources = [
      ...walk(DASHBOARD, (f) => /\.(css|tsx?|ts)$/.test(f) && !f.includes('.test.')),
      ...walk(EXPEDITION, (f) => /\.(css|tsx?|ts)$/.test(f)),
    ];
    const refs = new Set<string>();
    for (const file of sources) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\/assets\/[\w\-/.]+\.(?:webp|png|jpe?g|svg|gif)/g)) refs.add(m[0]);
    }
    // Rutas construidas en runtime: el equipo de escalada + la medalla de cumbre (ExpeditionPilot/Reward).
    for (const id of CLIMBING_GEAR_IDS) refs.add(gearAsset(id));
    refs.add(gearAsset(COSMETIC_REWARDS.find((r) => r.id === 'medal')!.id));
    expect(refs.size).toBeGreaterThan(3);
    const missing = [...refs].filter((ref) => !existsSync(path.join(PUBLIC, ref)));
    expect(missing, 'copia el asset de C:\\maity\\public o quita la referencia').toEqual([]);
  });

  it('ningún archivo llama al RPC get_user_learning_path (useLearningPath es stub sin red)', () => {
    const offenders = walk(SRC, (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('dashboard-guards.test.ts'))
      .filter((f) => /\.rpc\(\s*['"`]get_user_learning_path/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
