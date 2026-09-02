import { vi } from 'vitest';

type QueryResult<T = unknown> = { data: T | null; error: Error | null };

type TableMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (v: QueryResult) => void) => Promise<void>;
};

type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
type ChangeHandler = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void;

export interface MockChannel {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  /** Test-only: simulate the server emitting a status to the subscribe callback. */
  emitStatus: (status: RealtimeStatus, err?: Error) => void;
  /** Test-only: simulate a postgres_changes payload arriving to all matching listeners. */
  emitChange: (payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => void;
}

/** Registro de cada .from()/.rpc() con el schema que estuvo vigente al llamarlo. */
export interface SchemaCall {
  kind: 'from' | 'rpc';
  name: string;
  /** Schema efectivo: el de un .schema(x) explicito, o el default del cliente. */
  schema: string;
}

/** Registro de cada `.select(columns)` invocado sobre una tabla (issue #05 fase 2). */
export interface SelectCall {
  table: string;
  columns: unknown;
}

/** Registro de cada `.limit(n)` invocado sobre una tabla (issue #05 fase 2). */
export interface LimitCall {
  table: string;
  limit: unknown;
}

/**
 * @param defaultSchema El `db.schema` del cliente real. Debe reflejar
 *   lib/supabase.ts — es 'public' desde el issue #70. Los tests que verifican
 *   ruteo de schema dependen de que esto NO mienta.
 */
export function createMockSupabaseClient(defaultSchema = 'public') {
  const rpcHandlers = new Map<string, (args: unknown) => QueryResult>();
  const tableResults = new Map<string, QueryResult>();
  const channels = new Map<string, MockChannel>();
  const schemaCalls: SchemaCall[] = [];
  // Issue #05 fase 2: antes `.select`/`.limit` eran `vi.fn(chainable)` puros —
  // vitest SÍ registra sus `.mock.calls`, pero esa instancia de `chain` nace
  // fresca en CADA `.from()` (ver abajo) y no queda expuesta fuera de
  // `makeTable`, así que ningún test podía inspeccionarla. Estos arrays viven
  // en el closure de `createMockSupabaseClient` y sobreviven a los múltiples
  // `.from()` de una misma prueba — mismo patrón que `schemaCalls`.
  const selectCalls: SelectCall[] = [];
  const limitCalls: LimitCall[] = [];

  const makeTable = (name: string): TableMock => {
    const chain: Partial<TableMock> = {};
    const chainable = () => chain as TableMock;
    chain.select = vi.fn((columns?: unknown) => {
      selectCalls.push({ table: name, columns });
      return chainable();
    });
    chain.insert = vi.fn(chainable);
    chain.update = vi.fn(chainable);
    chain.delete = vi.fn(chainable);
    chain.upsert = vi.fn(chainable);
    chain.eq = vi.fn(chainable);
    chain.in = vi.fn(chainable);
    chain.order = vi.fn(chainable);
    chain.limit = vi.fn((limit?: unknown) => {
      limitCalls.push({ table: name, limit });
      return chainable();
    });
    chain.single = vi.fn(() => Promise.resolve(tableResults.get(name) ?? { data: null, error: null }));
    chain.maybeSingle = vi.fn(() => Promise.resolve(tableResults.get(name) ?? { data: null, error: null }));
    chain.then = (resolve) => {
      const r = tableResults.get(name) ?? { data: null, error: null };
      resolve(r);
      return Promise.resolve();
    };
    return chain as TableMock;
  };

  const makeChannel = (topic: string): MockChannel => {
    const changeHandlers: ChangeHandler[] = [];
    let statusCallback: ((s: RealtimeStatus, err?: Error) => void) | null = null;

    const channel: MockChannel = {
      topic,
      on: vi.fn((_event: string, _filter: unknown, handler: ChangeHandler) => {
        changeHandlers.push(handler);
        return channel;
      }),
      subscribe: vi.fn((cb?: (s: RealtimeStatus, err?: Error) => void) => {
        if (cb) statusCallback = cb;
        return channel;
      }),
      unsubscribe: vi.fn(async () => 'ok'),
      emitStatus: (status, err) => {
        statusCallback?.(status, err);
      },
      emitChange: (payload) => {
        const full = {
          eventType: payload.eventType ?? 'UPDATE',
          new: payload.new ?? {},
          old: payload.old ?? {},
        };
        for (const h of changeHandlers) h(full);
      },
    };
    return channel;
  };

  /**
   * Superficie de datos ligada a UN schema. `.schema(x)` devuelve una nueva
   * instancia con x, igual que supabase-js; el cliente raiz usa el default.
   *
   * Antes `.schema()` era `vi.fn(function () { return this })` — un passthrough
   * que TIRABA el schema pedido, asi que ningun test podia detectar una
   * regresion de ruteo (issue #70: 5 RPC en 403 durante meses sin que nada
   * fallara). Si vuelves a simplificar esto, ese agujero regresa.
   */
  const makeDataSurface = (schema: string) => ({
    from: vi.fn((name: string) => {
      schemaCalls.push({ kind: 'from', name, schema });
      return makeTable(name);
    }),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      schemaCalls.push({ kind: 'rpc', name: fn, schema });
      const handler = rpcHandlers.get(fn);
      if (!handler) return { data: null, error: new Error(`[mock-supabase] Unhandled rpc: ${fn}`) };
      return handler(args);
    }),
  });

  const client = {
    ...makeDataSurface(defaultSchema),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    schema: vi.fn((name: string) => makeDataSurface(name)),
    channel: vi.fn((topic: string) => {
      const ch = makeChannel(topic);
      channels.set(topic, ch);
      return ch;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  };

  return {
    client,
    setRpc(fn: string, handler: (args: unknown) => QueryResult) {
      rpcHandlers.set(fn, handler);
    },
    setTableResult(table: string, result: QueryResult) {
      tableResults.set(table, result);
    },
    /** Get a previously-created channel by topic (for emitStatus/emitChange). */
    getChannel(topic: string): MockChannel | undefined {
      return channels.get(topic);
    },
    /** Todas las llamadas de datos, en orden, con su schema efectivo. */
    get schemaCalls(): readonly SchemaCall[] {
      return schemaCalls;
    },
    /** Schema efectivo de la ULTIMA llamada a esa tabla/RPC, o undefined. */
    schemaOf(name: string): string | undefined {
      for (let i = schemaCalls.length - 1; i >= 0; i -= 1) {
        if (schemaCalls[i].name === name) return schemaCalls[i].schema;
      }
      return undefined;
    },
    /** Columnas del ÚLTIMO `.select(...)` sobre esa tabla, o undefined. */
    selectOf(table: string): unknown {
      for (let i = selectCalls.length - 1; i >= 0; i -= 1) {
        if (selectCalls[i].table === table) return selectCalls[i].columns;
      }
      return undefined;
    },
    /** Argumento del ÚLTIMO `.limit(...)` sobre esa tabla, o undefined. */
    limitOf(table: string): unknown {
      for (let i = limitCalls.length - 1; i >= 0; i -= 1) {
        if (limitCalls[i].table === table) return limitCalls[i].limit;
      }
      return undefined;
    },
    reset() {
      rpcHandlers.clear();
      tableResults.clear();
      channels.clear();
      schemaCalls.length = 0;
      selectCalls.length = 0;
      limitCalls.length = 0;
    },
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabaseClient>;
