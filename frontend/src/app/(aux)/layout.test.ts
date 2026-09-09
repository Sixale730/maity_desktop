/**
 * Invariantes estructurales de las ventanas auxiliares (#23 de la auditoría
 * de recursos, sep-2026).
 *
 * Por qué existe: Next empaqueta por layout. Mientras las rutas aux colgaban
 * del root layout de la main, `coach-float.html` cargaba 1.17 MB de JS
 * (providers, sonner, Radix, TanStack, fuentes, supabase-js) de los que la
 * página eran 27 KB; el early-return en runtime de RootLayout evitaba MONTAR,
 * no CARGAR. El arreglo es estructural (route groups `(main)` / `(aux)` con
 * dos root layouts) y este test es lo que impide deshacerlo sin querer:
 *
 *   1. No existe `app/layout.tsx` de nivel superior (volvería a envolver a
 *      TODAS las rutas) y cada grupo tiene su root layout con <html>/<body>.
 *   2. Bajo `(aux)` no hay layouts anidados: los tres que había devolvían
 *      <html><body> DENTRO del body del root (2 <html> por documento).
 *   3. `AUX_WINDOW_PATHS` (lib/auxWindows.ts) ↔ `app/(aux)/<label>/page.tsx`
 *      es una biyección: las labels de ventana son las rutas.
 *   4. `(aux)/layout.tsx` es server component y no trae `next/font`.
 *   5. El grafo de imports de las páginas aux + su layout NO alcanza los
 *      módulos pesados de la main (supabase-js, platformLogger, analytics,
 *      contexts, el grupo (main)) ni librerías que solo la main necesita.
 *      Un `import()` dinámico también cuenta: cargaría el chunk igual.
 *
 * Mismo molde que (main)/layout.test.ts y lib/supabase.test.ts: lee archivos
 * reales, sin mocks. El lint post-build `scripts/lint-aux-bundle.js` mide el
 * resultado en `out/`; este test atrapa la causa antes de compilar.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { AUX_WINDOW_PATHS } from '@/lib/auxWindows';

const AUX_GROUP = __dirname; // src/app/(aux)
const APP_DIR = path.resolve(AUX_GROUP, '..'); // src/app
const SRC = path.resolve(APP_DIR, '..'); // src
const MAIN_GROUP = path.join(APP_DIR, '(main)');
const AUX_LAYOUT = path.join(AUX_GROUP, 'layout.tsx');
const MAIN_LAYOUT = path.join(MAIN_GROUP, 'layout.tsx');

const AUX_LABELS = (AUX_WINDOW_PATHS as readonly string[]).map((p) => p.replace(/^\//, ''));

/** Archivos internos (relativos a src/, con `/`) que el grafo aux NO debe alcanzar. */
const FORBIDDEN_INTERNAL_FILES = ['lib/supabase.ts', 'lib/platformLogger.ts', 'lib/analytics.ts'];
/** Prefijos de directorio (relativos a src/) prohibidos en el grafo aux. */
const FORBIDDEN_INTERNAL_DIRS = ['contexts/', 'app/(main)/'];
/** Paquetes externos que solo la main necesita. */
const FORBIDDEN_EXTERNAL = ['sonner', '@tanstack/react-query', '@supabase/supabase-js', '@radix-ui/', 'next/font/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

// Mismo resolver que scripts/lint-tauri-acl.js: `@/…` y relativos, .ts/.tsx e index.
const EXTS = ['.ts', '.tsx'];
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // paquete externo
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

// `import type` no genera código: se ignora. `import()` dinámico SÍ cuenta.
const IMPORT_RE =
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string): { internal: string[]; external: string[] } {
  const content = readFileSync(file, 'utf8');
  const internal: string[] = [];
  const external: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    if (/^(import|export)\s+type\b/.test(m[0])) continue;
    const spec = m[1] || m[2];
    const resolved = resolveImport(file, spec);
    if (resolved) internal.push(resolved);
    else if (!spec.startsWith('.') && !spec.startsWith('@/')) external.push(spec);
  }
  return { internal, external };
}

/** Recorre el grafo desde `entries`; devuelve archivos internos y specs externos alcanzados. */
function reachable(entries: string[]): { files: Map<string, string>; externals: Map<string, string> } {
  const files = new Map<string, string>(); // file → quién lo importó primero
  const externals = new Map<string, string>(); // spec → archivo que lo importa
  const stack = entries.map((e) => [e, '<entry>'] as const);
  while (stack.length) {
    const [file, from] = stack.pop()!;
    if (files.has(file)) continue;
    files.set(file, from);
    const { internal, external } = importsOf(file);
    for (const spec of external) if (!externals.has(spec)) externals.set(spec, file);
    for (const dep of internal) if (!files.has(dep)) stack.push([dep, file]);
  }
  return { files, externals };
}

describe('app/(aux) — root layout propio de las ventanas auxiliares (#23)', () => {
  it('no existe app/layout.tsx de nivel superior y cada grupo tiene su root layout con <html>/<body>', () => {
    expect(
      existsSync(path.join(APP_DIR, 'layout.tsx')),
      'app/layout.tsx volvería a envolver a TODAS las rutas (aux incluidas) y Next lo empaquetaría para cada una. Los root layouts viven en app/(main)/layout.tsx y app/(aux)/layout.tsx.',
    ).toBe(false);
    for (const layout of [MAIN_LAYOUT, AUX_LAYOUT]) {
      expect(existsSync(layout), `${rel(layout)} no existe`).toBe(true);
      const src = readFileSync(layout, 'utf8');
      expect(src.includes('<html'), `${rel(layout)} debe renderizar <html> (es root layout)`).toBe(true);
      expect(src.includes('<body'), `${rel(layout)} debe renderizar <body> (es root layout)`).toBe(true);
    }
  });

  it('bajo (aux) no hay layouts anidados (devolvían <html><body> dentro del body del root)', () => {
    const nested = walk(AUX_GROUP)
      .filter((f) => path.basename(f) === 'layout.tsx' && f !== AUX_LAYOUT)
      .map(rel);
    expect(nested, 'layouts anidados bajo (aux): el título nativo lo pone Rust; el <title> va en (aux)/layout.tsx').toEqual([]);
  });

  it('AUX_WINDOW_PATHS ↔ app/(aux)/<label>/page.tsx es una biyección', () => {
    for (const label of AUX_LABELS) {
      expect(
        existsSync(path.join(AUX_GROUP, label, 'page.tsx')),
        `la ventana "${label}" (lib/auxWindows.ts) no tiene app/(aux)/${label}/page.tsx`,
      ).toBe(true);
    }
    const pages = walk(AUX_GROUP)
      .filter((f) => path.basename(f) === 'page.tsx')
      .map((f) => path.relative(AUX_GROUP, path.dirname(f)).replace(/\\/g, '/'));
    expect(
      pages.sort(),
      'toda página bajo (aux) debe ser una ventana auxiliar declarada en AUX_WINDOW_PATHS (labels == rutas; lint-tauri-acl atribuye capabilities por label)',
    ).toEqual([...AUX_LABELS].sort());
  });

  it('(aux)/layout.tsx es server component, sin next/font y sin style="" inline', () => {
    const src = readFileSync(AUX_LAYOUT, 'utf8');
    expect(/^\s*['"]use client['"]/m.test(src), '(aux)/layout.tsx no debe ser client component').toBe(false);
    // Import real, no la mención en el comentario del archivo.
    expect(/from\s+['"]next\/font/.test(src), 'las ventanas aux no usan las vars --font-*; next/font sobra').toBe(false);
    expect(/\sstyle=\{/.test(src), 'style={{…}} inline se bloquea por la CSP con nonce en el primer paint; usar clases').toBe(false);
  });

  it('el grafo de imports de las ventanas aux no alcanza supabase-js, platformLogger, analytics, contexts ni (main)', () => {
    const entries = [AUX_LAYOUT, ...AUX_LABELS.map((l) => path.join(AUX_GROUP, l, 'page.tsx'))];
    const { files, externals } = reachable(entries);

    const badFiles: string[] = [];
    for (const [file, from] of files) {
      const r = rel(file);
      if (FORBIDDEN_INTERNAL_FILES.includes(r) || FORBIDDEN_INTERNAL_DIRS.some((d) => r.startsWith(d))) {
        badFiles.push(`${r}  (importado desde ${from === '<entry>' ? from : rel(from)})`);
      }
    }
    expect(
      badFiles,
      '\nMódulos de la main alcanzables desde una ventana aux. Telemetría de producto en aux → lib/auxAnalytics.ts (comando nativo → outbox); feedback → save_user_feedback (Rust sincroniza).\n',
    ).toEqual([]);

    const badExternals: string[] = [];
    for (const [spec, from] of externals) {
      if (FORBIDDEN_EXTERNAL.some((p) => spec === p || spec.startsWith(p))) {
        badExternals.push(`${spec}  (importado desde ${rel(from)})`);
      }
    }
    expect(badExternals, '\nLibrerías que solo la main necesita, alcanzables desde una ventana aux.\n').toEqual([]);
  });
});
