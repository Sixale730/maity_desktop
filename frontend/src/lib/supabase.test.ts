/**
 * Invariantes de ruteo de schema del cliente Supabase.
 *
 * Contexto (issue #70): el cliente se creo con `db: { schema: 'maity' }` desde
 * el commit 230b807 (feb-2026), asi que TODA llamada `.rpc('x')` sin schema
 * explicito resolvia a `maity.x`. Cuando el hardening de la DB (issue web #143)
 * cerro el schema `maity` a los roles de cliente, 5 RPC del desktop empezaron a
 * devolver 403 — y NINGUNO fallo de forma visible:
 *
 *   - insert_platform_log  → `catch {}` vacio, ni siquiera inspecciona .error
 *   - calculate_user_streak / get_my_xp_summary → fallback a 0
 *   - insert_user_feedback → console.warn, sin reintento
 *   - get_user_role        → null, cae al heuristico por dominio de email
 *
 * O sea: el modo de falla de un `.rpc()` mal ruteado es SILENCIOSO, y por eso
 * paso meses sin que nadie lo notara. Estos tests son la red que faltaba.
 *
 * Dos invariantes, complementarios:
 *  1. El default del cliente es 'public' (el perimetro mediado: los wrappers
 *     SECURITY DEFINER donde vive la autorizacion).
 *  2. Ningun call site usa el default de forma implicita. Toda llamada de datos
 *     dice a que schema va. La regla de lint en .eslintrc.json cubre `.rpc()`;
 *     este test cubre ADEMAS `.from()`, que el lint deja pasar a proposito.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '..');

/**
 * Rutas exentas del invariante 2.
 *
 * `shared/maity-shared` es el arbol copiado zero-drift de Sixale730/maity: sus
 * `.rpc()` pelones son correctos justamente porque el default es 'public', y
 * reescribirlos meteria drift contra el repo web. Sus `.from()` si llevan
 * `.schema('maity')` explicito.
 */
const EXEMPT_PATTERNS = [
  'shared/maity-shared/',
  'test/mocks/',
];

interface Violation {
  file: string;
  line: number;
  call: string;
}

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

/** `supabase.from(...)` / `supabase.rpc(...)` — receptor identificador pelado. */
function findBareCalls(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;

      // Solo el receptor `supabase` pelado. `supabase.schema('x').from(...)`
      // tiene un CallExpression como receptor, no un Identifier, asi que no
      // matchea — que es exactamente lo que queremos.
      if (
        (method === 'from' || method === 'rpc') &&
        ts.isIdentifier(receiver) &&
        receiver.text === 'supabase'
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const arg = node.arguments[0];
        const name = arg && ts.isStringLiteral(arg) ? arg.text : '?';
        violations.push({
          file: path.relative(SRC_ROOT, filePath).replace(/\\/g, '/'),
          line: line + 1,
          call: `supabase.${method}('${name}')`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('cliente Supabase: ruteo de schema (issue #70)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("el default del cliente es 'public', no 'maity'", async () => {
    const createClient = vi.fn(() => ({}));
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));

    const { supabase } = await import('./supabase');
    // El cliente es lazy detras de un Proxy: hay que tocarlo para instanciarlo.
    void supabase.auth;

    expect(createClient, 'createClient nunca se llamo').toHaveBeenCalledTimes(1);

    const options = createClient.mock.calls[0][2] as { db?: { schema?: string } };
    expect(
      options?.db?.schema,
      "El cliente debe apuntar a 'public' por default. Con 'maity', todo .rpc() " +
        'sin schema explicito cae en un schema cerrado a los roles de cliente y ' +
        'devuelve 403 EN SILENCIO. Ver issue #70.',
    ).toBe('public');
  });

  it('ningun call site llama .from()/.rpc() sin schema explicito', () => {
    const violations = collectSourceFiles(SRC_ROOT)
      .filter((f) => {
        const rel = path.relative(SRC_ROOT, f).replace(/\\/g, '/');
        return !EXEMPT_PATTERNS.some((p) => rel.startsWith(p));
      })
      .flatMap((f) => findBareCalls(f, readFileSync(f, 'utf-8')));

    const detail = violations.map((v) => `  ${v.file}:${v.line}  ${v.call}`).join('\n');

    expect(
      violations,
      `\nLlamadas que dependen del default del cliente:\n${detail}\n\n` +
        "Arreglo: .schema('public') para un wrapper/RPC, .schema('maity') para " +
        'una tabla de maity. Un .rpc() mal ruteado da 403 silencioso; un .from() ' +
        'mal ruteado da PGRST205. Ver issue #70.\n',
    ).toEqual([]);
  });
});
