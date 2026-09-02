import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listenMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: unknown) => listenMock(event, handler),
}));

import { createSubscriptionGroup, subscribeTauriEvent, subscribeUnlisten } from './tauriSubscribe';

/** Cede el turno para que corran los .then() pendientes. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('tauriSubscribe (issue #65)', () => {
  beforeEach(() => {
    listenMock.mockReset();
  });

  describe('createSubscriptionGroup', () => {
    it('libera cada listener una sola vez al desechar', async () => {
      const un1 = vi.fn();
      const un2 = vi.fn();
      const group = createSubscriptionGroup();
      group.add(Promise.resolve(un1));
      group.add(Promise.resolve(un2));
      await flush();

      group.dispose();

      expect(un1).toHaveBeenCalledTimes(1);
      expect(un2).toHaveBeenCalledTimes(1);
    });

    it('un segundo dispose() NO vuelve a llamar al unlisten', async () => {
      // Este es el bug: en Tauri, desregistrar dos veces el mismo eventId tira
      // "Cannot read properties of undefined (reading 'handlerId')".
      const un = vi.fn();
      const group = createSubscriptionGroup();
      group.add(Promise.resolve(un));
      await flush();

      group.dispose();
      group.dispose();
      group.dispose();

      expect(un).toHaveBeenCalledTimes(1);
      expect(group.isDisposed).toBe(true);
    });

    it('libera de inmediato el listener que resuelve DESPUES del dispose', async () => {
      // La carrera de desmontaje: el cleanup gana al await. Antes el listener
      // quedaba vivo para siempre porque la variable ya no la leia nadie.
      const un = vi.fn();
      let resolveListen: ((fn: () => void) => void) | null = null;
      const pending = new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      });

      const group = createSubscriptionGroup();
      group.add(pending);
      group.dispose();
      expect(un).not.toHaveBeenCalled();

      resolveListen!(un);
      await flush();

      expect(un).toHaveBeenCalledTimes(1);
    });

    it('un listen() rechazado no propaga', async () => {
      const group = createSubscriptionGroup();
      group.add(Promise.reject(new Error('listen fallo')));
      await flush();

      expect(() => group.dispose()).not.toThrow();
    });

    it('un unlisten que LANZA no propaga', async () => {
      // Defensa en profundidad: aunque el latch evita el doble-unlisten propio,
      // Tauri puede tronar por su cuenta y no debe salir como unhandledrejection.
      const un = vi.fn(() => {
        throw new Error('handlerId undefined');
      });
      const group = createSubscriptionGroup();
      group.add(Promise.resolve(un));
      await flush();

      expect(() => group.dispose()).not.toThrow();
    });

    it('un unlisten que devuelve promesa rechazada no propaga', async () => {
      const un = vi.fn(() => Promise.reject(new Error('backend caido')));
      const group = createSubscriptionGroup();
      group.add(Promise.resolve(un));
      await flush();

      group.dispose();
      await flush();
      expect(un).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeTauriEvent', () => {
    it('devuelve el disposer de forma sincrona, sin esperar a listen()', () => {
      listenMock.mockImplementation(() => new Promise(() => {}));
      const dispose = subscribeTauriEvent('foo', () => {});
      expect(typeof dispose).toBe('function');
      expect(listenMock).toHaveBeenCalledWith('foo', expect.any(Function));
    });

    it('es idempotente igual que el grupo', async () => {
      const un = vi.fn();
      listenMock.mockImplementation(async () => un);

      const dispose = subscribeTauriEvent('foo', () => {});
      await flush();
      dispose();
      dispose();

      expect(un).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeUnlisten', () => {
    it('envuelve una promesa de unlisten ajena a listen()', async () => {
      const un = vi.fn();
      const dispose = subscribeUnlisten(Promise.resolve(un));
      await flush();
      dispose();
      dispose();
      expect(un).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Fitness function: nadie importa `listen` directo fuera de la lista blanca.
 *
 * La regla `no-restricted-imports` de .eslintrc.json cubre lo mismo, pero el
 * lint no corre en el build de Tauri (`next build` lo salta) y es facil de
 * silenciar con un eslint-disable. Este test corre con el resto de la suite.
 * Mismo molde que lib/supabase.test.ts (#70) y app/layout.test.ts.
 */
const SRC_ROOT = path.resolve(__dirname, '..');

/**
 * Unicos autorizados (ver el override gemelo en .eslintrc.json):
 *  - tauriSubscribe.ts ES la implementacion.
 *  - recording/transcriptService son wrappers finos que DEVUELVEN la promesa
 *    del unlisten; el ciclo de vida lo maneja el llamador con el grupo.
 *  - errorTelemetry.ts es fire-and-forget deliberado (init idempotente sin
 *    teardown, documentado en CLAUDE.md).
 *  - audioLevelsStore.ts (issue #07) es un store singleton fuera de React:
 *    el ref-count de suscriptores sube y baja entre MUCHOS componentes hoja
 *    independientes, no un ciclo de vida 1:1 con un solo useEffect — no
 *    encaja en el modelo de createSubscriptionGroup. Reimplementa
 *    localmente la misma defensa anti-doble-unlisten de este archivo.
 *  - el arbol copiado zero-drift y los tests.
 */
const EXEMPT_PATTERNS = [
  'lib/tauriSubscribe.ts',
  'lib/errorTelemetry.ts',
  'lib/audioLevelsStore.ts',
  'services/recordingService.ts',
  'services/transcriptService.ts',
  'shared/maity-shared/',
];

interface Violation {
  file: string;
  line: number;
  imported: string;
}

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

/** Imports de `listen`/`once` desde '@tauri-apps/api/event'. */
function findBareListenImports(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];
  const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');

  /**
   * Para `const { a, b } = await import('...')` devuelve ['a','b'].
   * `null` si no se puede determinar (el modulo se guarda entero, se encadena
   * un .then(), etc.) — en ese caso el llamador marca por conservador.
   */
  function destructuredNames(importCall: ts.CallExpression): string[] | null {
    // El await es opcional: `await import(...)` mete un AwaitExpression en medio.
    let cursor: ts.Node = importCall;
    if (cursor.parent && ts.isAwaitExpression(cursor.parent)) cursor = cursor.parent;
    const decl = cursor.parent;
    if (!decl || !ts.isVariableDeclaration(decl)) return null;
    if (!ts.isObjectBindingPattern(decl.name)) return null;
    return decl.name.elements.map((el) => (el.propertyName ?? el.name).getText(sourceFile));
  }

  function record(node: ts.Node, imported: string) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ file: rel, line: line + 1, imported });
  }

  function visit(node: ts.Node): void {
    // import { listen } from '@tauri-apps/api/event'
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@tauri-apps/api/event'
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          // El nombre REAL importado (no el alias): `listen as l` sigue contando.
          const name = (el.propertyName ?? el.name).text;
          if ((name === 'listen' || name === 'once') && !el.isTypeOnly) {
            record(el, name);
          }
        }
      }
    }

    // const { listen } = await import('@tauri-apps/api/event')  ← asi estaba
    // el listener del meeting detector en useRecordingStart.ts. El import
    // estatico no lo veia ningun grep, por eso el test mira los dos.
    // `emit` por import dinamico es legitimo y no se marca.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '@tauri-apps/api/event'
    ) {
      const bound = destructuredNames(node);
      // Si no se puede determinar que se extrae (p. ej. se guarda el modulo
      // entero), se marca por conservador.
      if (bound === null || bound.some((n) => n === 'listen' || n === 'once')) {
        record(node, bound === null ? 'import() dinamico' : 'import() dinamico -> listen');
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('suscripcion a eventos Tauri: sin listen() suelto (issue #65)', () => {
  it("nadie importa `listen` de '@tauri-apps/api/event' fuera de la lista blanca", () => {
    const files = collectSourceFiles(SRC_ROOT).filter((f) => {
      const rel = path.relative(SRC_ROOT, f).replace(/\\/g, '/');
      if (/\.test\.tsx?$/.test(rel)) return false;
      return !EXEMPT_PATTERNS.some((p) => rel.startsWith(p) || rel.includes(p));
    });

    expect(files.length).toBeGreaterThan(100); // sanity: el walker encontro el arbol

    const violations = files.flatMap((f) => findBareListenImports(f, readFileSync(f, 'utf8')));

    const detail = violations.map((v) => `  ${v.file}:${v.line} importa ${v.imported}`).join('\n');
    expect(
      violations,
      violations.length === 0
        ? ''
        : `Import directo de listen() fuera de la lista blanca:\n${detail}\n\n` +
            "Usa subscribeTauriEvent/createSubscriptionGroup de '@/lib/tauriSubscribe': " +
            'un listen() suelto se desregistra dos veces o se filtra al desmontar ' +
            "antes de que resuelva, y Tauri tira \"reading 'handlerId'\" (issue #65).",
    ).toEqual([]);
    // Parsea todo src/ con el TS Compiler API (~3 s en frío, >5 s con la
    // máquina cargada por el build). El coste es legítimo; el default de 5 s no.
  }, 30_000);
});
