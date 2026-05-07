/**
 * Layout provider tree invariants.
 *
 * Cuando un componente requiere ejecutar side effects independientes del
 * estado de auth (ej: el plugin updater de Tauri), no puede vivir como
 * descendiente JSX de un gate condicional. Si lo hace, sus useEffect no
 * disparan hasta que el gate deja pasar children — lo que en maquinas con
 * login lento equivale a "nunca".
 *
 * Este test parsea layout.tsx con TypeScript Compiler API y valida cada
 * invariante en PROVIDER_INVARIANTS. Para agregar otro invariante, sumar
 * una entrada al array. No hay que tocar el algoritmo.
 *
 * Regresion historica: commit 230b807 (2026-02-02) puso UpdateCheckProvider
 * dentro de AuthGate. El bug paso 3 meses sin detectarse y sobrevivio 2-3
 * intentos de fix porque atacaron sintomas. Este test lo atrapa en CI.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, it, expect } from 'vitest';

interface ProviderInvariant {
  component: string;
  mustNotBeDescendantOf: string[];
  reason: string;
}

const PROVIDER_INVARIANTS: ProviderInvariant[] = [
  {
    component: 'UpdateCheckProvider',
    mustNotBeDescendantOf: ['AuthGate', 'AuthProvider'],
    reason:
      'El plugin updater no requiere sesion Supabase. Ponerlo dentro de un auth gate hace que el auto-check no dispare en maquinas con login lento. Ver commit 230b807.',
  },
];

const LAYOUT_PATH = path.resolve(__dirname, 'layout.tsx');

function getJsxElementName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tagName =
    node.kind === ts.SyntaxKind.JsxElement
      ? node.openingElement.tagName
      : node.tagName;

  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) return tagName.name.text;
  return '';
}

/**
 * Camina el AST recursivamente y registra para cada elemento JSX cuyo
 * nombre matchea uno de `targetComponents`, los nombres de TODOS sus
 * ancestros JSX (de mas cercano a mas lejano).
 */
function collectJsxAncestors(
  sourceFile: ts.SourceFile,
  targetComponents: Set<string>,
): Map<string, string[][]> {
  const occurrences = new Map<string, string[][]>();
  const ancestorStack: string[] = [];

  function visit(node: ts.Node): void {
    const isJsxElement = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
    let pushed = false;
    let elementName = '';

    if (isJsxElement) {
      elementName = getJsxElementName(node as ts.JsxElement | ts.JsxSelfClosingElement);
      if (elementName && targetComponents.has(elementName)) {
        const existing = occurrences.get(elementName) ?? [];
        existing.push([...ancestorStack]);
        occurrences.set(elementName, existing);
      }
      if (elementName) {
        ancestorStack.push(elementName);
        pushed = true;
      }
    }

    ts.forEachChild(node, visit);

    if (pushed) ancestorStack.pop();
  }

  visit(sourceFile);
  return occurrences;
}

describe('layout.tsx provider tree invariants', () => {
  const source = readFileSync(LAYOUT_PATH, 'utf-8');
  const sourceFile = ts.createSourceFile(
    LAYOUT_PATH,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  for (const invariant of PROVIDER_INVARIANTS) {
    it(`${invariant.component} no debe ser descendiente de [${invariant.mustNotBeDescendantOf.join(', ')}]`, () => {
      const targets = new Set<string>([
        invariant.component,
        ...invariant.mustNotBeDescendantOf,
      ]);
      const occurrences = collectJsxAncestors(sourceFile, targets);

      const componentOccurrences = occurrences.get(invariant.component) ?? [];

      // El componente debe aparecer al menos una vez en layout.tsx — si no,
      // probablemente alguien lo movio a otro archivo o lo renombro y este
      // invariante quedo huerfano. Fallar con mensaje claro.
      expect(
        componentOccurrences.length,
        `${invariant.component} no se encontro en layout.tsx. ` +
          `Si lo moviste a otro archivo, actualiza PROVIDER_INVARIANTS o el test path.`,
      ).toBeGreaterThan(0);

      for (const ancestors of componentOccurrences) {
        const forbiddenFound = ancestors.find((a) =>
          invariant.mustNotBeDescendantOf.includes(a),
        );

        expect(
          forbiddenFound,
          `\nVIOLACION: <${invariant.component}> tiene como ancestro JSX a <${forbiddenFound}> en layout.tsx.\n` +
            `Cadena de ancestros (cercano → lejano): ${ancestors.join(' → ')}\n\n` +
            `Razon: ${invariant.reason}\n`,
        ).toBeUndefined();
      }
    });
  }

  it('comentario MARKER critico sigue presente en layout.tsx', () => {
    expect(
      source.includes('CRITICAL: <UpdateCheckProvider> debe vivir FUERA'),
      'El comentario MARKER fue eliminado de layout.tsx. ' +
        'Si lo borraste a proposito, considera tambien retirar el invariante de PROVIDER_INVARIANTS.',
    ).toBe(true);
  });
});
