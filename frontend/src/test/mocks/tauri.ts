import { vi, type Mock } from 'vitest';

type InvokeHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers = new Map<string, InvokeHandler>();
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

export const invoke: Mock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const handler = handlers.get(cmd);
  if (!handler) {
    throw new Error(`[mock-tauri] Unhandled invoke: ${cmd}`);
  }
  return await handler(args);
});

export const listen: Mock = vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  return () => {
    listeners.get(event)?.delete(cb);
  };
});

export const emit: Mock = vi.fn(async (event: string, payload?: unknown) => {
  listeners.get(event)?.forEach(cb => cb({ payload }));
});

export function mockInvokeHandler(cmd: string, handler: InvokeHandler): void {
  handlers.set(cmd, handler);
}

export function mockInvokeResult(cmd: string, result: unknown): void {
  handlers.set(cmd, async () => result);
}

export function mockInvokeError(cmd: string, error: Error | string): void {
  handlers.set(cmd, async () => {
    throw error instanceof Error ? error : new Error(error);
  });
}

export function resetTauriMocks(): void {
  handlers.clear();
  listeners.clear();
  invoke.mockClear();
  listen.mockClear();
  emit.mockClear();
}

export function emitFromRust(event: string, payload: unknown): void {
  listeners.get(event)?.forEach(cb => cb({ payload }));
}
