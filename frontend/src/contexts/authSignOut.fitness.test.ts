/**
 * Fitness test: todo logout pasa por `AuthContext.signOut` (#83, bug B1).
 *
 * El footer del sidebar del chat (`SidebarFooterV5`) cerraba sesion llamando al
 * signOut de supabase-js directo. Eso se saltaba `logout_cleanup` (Rust), que
 * detiene y GUARDA la grabacion activa mientras `current_user_id` sigue vivo:
 * el segmento de jornada terminaba `Failed` por "sin usuario logueado" y
 * `cloud_sync_clear_session` nunca corria desde esa superficie.
 *
 * Regla: solo `contexts/AuthContext.tsx` llama al signOut de supabase-js, y lo
 * hace DESPUES de `logout_cleanup` y `cloud_sync_clear_session`. Cualquier otro
 * boton usa `useAuth().signOut()`. Detalle: docs/NUBE_CUENTAS_SYNC.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '..');

/** Rutas (relativas a src/, con `/`) que el invariante no revisa. */
const EXEMPT_PREFIXES = [
  // Arbol copiado zero-drift de la web.
  'shared/maity-shared/',
  // Mocks de tests: definen `signOut: vi.fn(...)`, no lo llaman.
  'test/mocks/',
];

/** El unico archivo autorizado a llamar al signOut de supabase-js. */
const AUTHORIZED_FILE = 'contexts/AuthContext.tsx';

const FORBIDDEN_CALL = /\.auth\s*\.\s*signOut\s*\(/;

/** Todos los .ts/.tsx bajo src/, recursivo. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Quita comentarios conservando el numero de lineas (los bloques se reemplazan
 * por sus saltos de linea) y sin romper `http://` (el `//` precedido de `:` no
 * abre comentario).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Numeros de linea (1-based) con una llamada prohibida fuera de comentarios. */
function findViolations(src: string): number[] {
  const lines = stripComments(src).split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (FORBIDDEN_CALL.test(line)) hits.push(i + 1);
  });
  return hits;
}

function isExempt(relPath: string): boolean {
  if (relPath === AUTHORIZED_FILE) return true;
  if (/\.(test|spec)\./.test(path.basename(relPath))) return true;
  return EXEMPT_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

describe('logout: solo AuthContext llama al signOut de supabase-js', () => {
  it('ningun archivo fuera de AuthContext llama al signOut de supabase-js directo', () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (isExempt(rel)) continue;
      for (const line of findViolations(readFileSync(file, 'utf8'))) {
        violations.push(`src/${rel}:${line}`);
      }
    }
    expect(
      violations,
      'Llamada directa al signOut de supabase-js fuera de AuthContext: usar useAuth().signOut() ' +
        '(pasa por logout_cleanup y guarda la grabacion). Ver docs/NUBE_CUENTAS_SYNC.md ' +
        '§ "Todo logout pasa por AuthContext.signOut".',
    ).toEqual([]);
  });

  it('el detector reconoce la forma prohibida', () => {
    // Armado por concatenacion para que este archivo no contenga la forma literal.
    const call = 'supabase' + '.auth' + '.signOut()';
    expect(findViolations(`const a = 1;\nawait ${call};\n`)).toEqual([2]);
    expect(findViolations(`// await ${call};\n`)).toEqual([]);
    expect(findViolations(`/*\n await ${call};\n*/\nconst b = 2;\n`)).toEqual([]);
    expect(findViolations(`const u = 'http://x';\nawait ${call};\n`)).toEqual([2]);
  });
});
