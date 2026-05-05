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

export function createMockSupabaseClient() {
  const rpcHandlers = new Map<string, (args: unknown) => QueryResult>();
  const tableResults = new Map<string, QueryResult>();
  const channels = new Map<string, MockChannel>();

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
    reset() {
      rpcHandlers.clear();
      tableResults.clear();
      channels.clear();
    },
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabaseClient>;
