import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resuelve con el valor si la promesa llega antes del plazo', async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000, 'x')).resolves.toBe(42);
  });

  it('propaga el rechazo original si llega antes del plazo', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'x')).rejects.toThrow('boom');
  });

  it('rechaza con la etiqueta si la promesa nunca se resuelve (deadlock de supabase-js)', async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => {});
    const result = withTimeout(never, 10_000, 'Auth getSession');
    const assertion = expect(result).rejects.toThrow('Auth getSession timeout (10000ms)');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    await expect(result).rejects.toBeInstanceOf(TimeoutError);
  });
});
