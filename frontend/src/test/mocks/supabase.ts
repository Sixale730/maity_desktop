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

export function createMockSupabaseClient() {
  const rpcHandlers = new Map<string, (args: unknown) => QueryResult>();
  const tableResults = new Map<string, QueryResult>();

  const makeTable = (name: string): TableMock => {
    const chain: Partial<TableMock> = {};
    const chainable = () => chain as TableMock;
    chain.select = vi.fn(chainable);
    chain.insert = vi.fn(chainable);
    chain.update = vi.fn(chainable);
    chain.delete = vi.fn(chainable);
    chain.upsert = vi.fn(chainable);
    chain.eq = vi.fn(chainable);
    chain.in = vi.fn(chainable);
    chain.order = vi.fn(chainable);
    chain.limit = vi.fn(chainable);
    chain.single = vi.fn(() => Promise.resolve(tableResults.get(name) ?? { data: null, error: null }));
    chain.maybeSingle = vi.fn(() => Promise.resolve(tableResults.get(name) ?? { data: null, error: null }));
    chain.then = (resolve) => {
      const r = tableResults.get(name) ?? { data: null, error: null };
      resolve(r);
      return Promise.resolve();
    };
    return chain as TableMock;
  };

  const client = {
    from: vi.fn((name: string) => makeTable(name)),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      const handler = rpcHandlers.get(fn);
      if (!handler) return { data: null, error: new Error(`[mock-supabase] Unhandled rpc: ${fn}`) };
      return handler(args);
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    schema: vi.fn(function (this: unknown) {
      return this;
    }),
  };

  return {
    client,
    setRpc(fn: string, handler: (args: unknown) => QueryResult) {
      rpcHandlers.set(fn, handler);
    },
    setTableResult(table: string, result: QueryResult) {
      tableResults.set(table, result);
    },
    reset() {
      rpcHandlers.clear();
      tableResults.clear();
    },
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabaseClient>;
