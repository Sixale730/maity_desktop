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
  {
    component: 'ErrorTelemetryInitializer',
    mustNotBeDescendantOf: ['AuthGate', 'AuthProvider', 'ErrorBoundary', 'DbInitErrorGate'],
    reason:
      'La telemetria de errores debe capturar errores pre-auth y seguir viva cuando ErrorBoundary desmonta el arbol al mostrar su fallback. Dentro de cualquiera de esos gates, los errores mas valiosos (los que tumban la app o pasan antes del login) jamas llegarian a platform_logs. DbInitErrorGate incluido (ago-2026): los app.error de db-init son justo los que reporta — con el gate mostrando su fallback, el initializer desmontado no reportaria nada (el presupuesto db-init=3 del ErrorReportLimiter existe para ellos).',
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

  // Premisa del lint de ACL (scripts/lint-tauri-acl.js): el root layout se
  // atribuye SOLO a la ventana main porque las rutas aux hacen early-return
  // ANTES de montar AppContent (donde viven onCloseRequested, app.open, etc.).
  // Si alguien mueve ese return debajo del primer <AppContent, los call sites
  // del root layout correrian tambien en coach-float/recording-widget/
  // device-picker con capabilities que no los declaran.
  it('el early-return de rutas aux precede al primer <AppContent dentro de RootLayout', () => {
    // Anclado a RootLayout: AppContent tambien llama isAuxWindowPath para su
    // propio gate, y esa ocurrencia (anterior en el archivo) no es la premisa.
    const rootLayoutStart = source.indexOf('function RootLayout');
    expect(rootLayoutStart, 'function RootLayout no encontrada en layout.tsx').toBeGreaterThan(-1);
    const auxReturn = source.indexOf('isAuxWindowPath(pathname)', rootLayoutStart);
    const firstAppContent = source.indexOf('<AppContent', rootLayoutStart);
    expect(auxReturn, 'isAuxWindowPath(pathname) no encontrado en RootLayout').toBeGreaterThan(-1);
    expect(firstAppContent, '<AppContent no encontrado en RootLayout').toBeGreaterThan(-1);
    expect(
      auxReturn,
      'El early-return de rutas aux debe evaluarse ANTES de montar AppContent — es la premisa con la que lint-tauri-acl.js atribuye el root layout solo a la ventana main.',
    ).toBeLessThan(firstAppContent);
  });

  // Issue #66: el gate de registro era `registrationFormCompleted === false`,
  // así que un `null` (RPC my_status caída, arranque sin red) caía al main
  // app y el usuario grababa sin registrarse. Debe ser FAIL-CLOSED: solo
  // `true` pasa. El gate de Rust (initialize_recording) es la autoridad; este
  // es el de render, y no debe volver a abrirse por accidente.
  it('el gate de registro de AppContent es fail-closed (`!== true`, nunca `=== false` como guard externo)', () => {
    const appContentStart = source.indexOf('function AppContent');
    expect(appContentStart, 'function AppContent no encontrada en layout.tsx').toBeGreaterThan(-1);
    const body = source.slice(appContentStart);
    expect(
      body.includes('registrationFormCompleted !== true && !isSpecialRoute'),
      'El guard externo del gate de registro debe ser `registrationFormCompleted !== true && !isSpecialRoute`.',
    ).toBe(true);
    expect(
      body.includes('registrationFormCompleted === false && !isSpecialRoute'),
      'Regresión #66: `=== false` como guard externo deja pasar `null` (RPC caída) al main app.',
    ).toBe(false);
  });

  it('comentario MARKER critico sigue presente en layout.tsx', () => {
    expect(
      source.includes('CRITICAL: <UpdateCheckProvider> debe vivir FUERA'),
      'El comentario MARKER fue eliminado de layout.tsx. ' +
        'Si lo borraste a proposito, considera tambien retirar el invariante de PROVIDER_INVARIANTS.',
    ).toBe(true);
  });

  // Regresion historica: en commit 15c5c5a (Feb 22, 2026) el Toaster cambio
  // de "bottom-center" -> "bottom-right" pero showUpdateNotification siguio
  // pidiendo "bottom-center". Sonner v2 crea contenedores positioned separados
  // por position; un mismatch puede dejar el toast del updater fuera del
  // viewport o en un contenedor que nunca se monta.
  //
  // Este invariante valida: si showUpdateNotification ESPECIFICA un position
  // override, ese override DEBE coincidir con el del Toaster en layout.tsx.
  // Si no lo especifica (caso preferido — herencia del Toaster), el test pasa.
  it('Toaster position en layout.tsx coincide con showUpdateNotification (si la especifica)', () => {
    const NOTIFICATION_PATH = path.resolve(
      __dirname,
      '..',
      'components',
      'updates',
      'UpdateNotification.tsx',
    );
    const notifSrc = readFileSync(NOTIFICATION_PATH, 'utf-8');

    const toasterMatch = source.match(/<Toaster\s+position="([^"]+)"/);
    expect(
      toasterMatch,
      '<Toaster position="..."> no encontrado en layout.tsx',
    ).not.toBeNull();

    // Buscar position en options pasadas a toast(), toast.info(), etc.
    // Solo dentro de showUpdateNotification (no en otros toasts del archivo).
    const showUpdateBody = notifSrc.match(
      /export function showUpdateNotification[\s\S]*?^\}/m,
    )?.[0];
    expect(
      showUpdateBody,
      'showUpdateNotification no encontrado en UpdateNotification.tsx',
    ).toBeDefined();

    const toastPositionMatch = showUpdateBody!.match(/position:\s*'([^']+)'/);

    if (toastPositionMatch) {
      expect(
        toasterMatch![1],
        `Toaster=${toasterMatch![1]} ≠ toast=${toastPositionMatch[1]}. ` +
          'Si showUpdateNotification especifica position, debe coincidir con el Toaster ' +
          'o quitarse para que herede. Sonner v2 separa contenedores por position.',
      ).toBe(toastPositionMatch[1]);
    }
    // Si no hay position override en el toast, el test pasa — herencia del Toaster.
  });
});
