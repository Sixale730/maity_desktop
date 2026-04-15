import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  makeRetryable,
  isRetryExhaustedError,
  RetryExhaustedError,
  CircuitBreaker,
} from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna el resultado si la función pasa al primer intento', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta hasta maxRetries y devuelve éxito cuando alguno pasa', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 3, initialDelay: 10, jitter: false });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('lanza RetryExhaustedError después de agotar intentos', async () => {
    const fn = vi.fn(async () => {
      throw new Error('network error');
    });

    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 10, jitter: false });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('no reintenta si isRetryable devuelve false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fatal');
    });
    const isRetryable = vi.fn(() => false);

    const promise = withRetry(fn, { maxRetries: 5, initialDelay: 10, isRetryable, jitter: false });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryable).toHaveBeenCalledTimes(1);
  });

  it('no reintenta en errores 4xx excepto 408 y 429', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Request failed with status: 400');
    });
    const promise = withRetry(fn, { maxRetries: 3, initialDelay: 10, jitter: false });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta en errores 5xx', async () => {
    const fn = vi.fn(async () => {
      throw new Error('status: 503');
    });
    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 10, jitter: false });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reintenta en errores 429 (rate limit)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('status: 429');
    });
    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 10, jitter: false });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('llama onRetry con el número de intento, error y delay', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 100, jitter: false, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });

  it('aplica backoff exponencial', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error('network error');
    });

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffMultiplier: 2,
      jitter: false,
      onRetry,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 200);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 400);
  });

  it('limita el delay con maxDelay', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error('network error');
    });

    const promise = withRetry(fn, {
      maxRetries: 4,
      initialDelay: 1000,
      maxDelay: 2000,
      backoffMultiplier: 10,
      jitter: false,
      onRetry,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    for (const call of onRetry.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(2000);
    }
  });

  it('aborta si el signal ya está abortado', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 'ok');

    await expect(withRetry(fn, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('aborta durante la espera entre reintentos', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      throw new Error('network error');
    });

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 1000,
      jitter: false,
      signal: controller.signal,
    });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.runAllTimersAsync();

    await assertion;
  });

  it('captura excepciones de onRetry sin fallar el retry', async () => {
    const onRetry = vi.fn(() => {
      throw new Error('callback failed');
    });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 10, jitter: false, onRetry });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });
});

describe('makeRetryable', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envuelve una función async con retry', async () => {
    const original = vi.fn(async (a: number, b: number) => a + b);
    const retryable = makeRetryable(original);

    await expect(retryable(2, 3)).resolves.toBe(5);
    expect(original).toHaveBeenCalledWith(2, 3);
  });

  it('reintenta la función envuelta en fallos transitorios', async () => {
    const original = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce('ok');
    const retryable = makeRetryable(original, { maxRetries: 2, initialDelay: 10, jitter: false });

    const promise = retryable();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });
});

describe('isRetryExhaustedError', () => {
  it('devuelve true para RetryExhaustedError', () => {
    const err = new RetryExhaustedError(3, new Error('x'));
    expect(isRetryExhaustedError(err)).toBe(true);
  });

  it('devuelve false para otros errores', () => {
    expect(isRetryExhaustedError(new Error('x'))).toBe(false);
    expect(isRetryExhaustedError(null)).toBe(false);
    expect(isRetryExhaustedError('string')).toBe(false);
  });
});

describe('RetryExhaustedError', () => {
  it('incluye el número de intentos y el último error en el mensaje', () => {
    const err = new RetryExhaustedError(5, new Error('original cause'));
    expect(err.attempts).toBe(5);
    expect(err.message).toContain('5 attempts');
    expect(err.message).toContain('original cause');
    expect(err.name).toBe('RetryExhaustedError');
  });

  it('maneja errores no-Error como lastError', () => {
    const err = new RetryExhaustedError(2, 'string error');
    expect(err.attempts).toBe(2);
    expect(err.message).toBe('Retry exhausted after 2 attempts');
  });
});

describe('CircuitBreaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ejecuta la función en estado "closed"', async () => {
    const fn = vi.fn(async () => 'ok');
    const cb = new CircuitBreaker(fn);

    await expect(cb.execute()).resolves.toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('abre el circuito tras alcanzar el threshold', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const cb = new CircuitBreaker(fn, { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute()).rejects.toThrow('boom');
    }
    expect(cb.getState()).toBe('open');

    await expect(cb.execute()).rejects.toThrow('Circuit breaker is open');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('transiciona a "half-open" después del reset timeout', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, resetTimeout: 1000 });

    await expect(cb.execute()).rejects.toThrow();
    await expect(cb.execute()).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    vi.setSystemTime(Date.now() + 1500);

    fn.mockResolvedValueOnce('recovered');
    await expect(cb.execute()).resolves.toBe('recovered');
    expect(cb.getState()).toBe('closed');
  });

  it('notifica cambios de estado vía onStateChange', async () => {
    const onStateChange = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const cb = new CircuitBreaker(fn, { failureThreshold: 1, onStateChange });

    await expect(cb.execute()).rejects.toThrow();

    expect(onStateChange).toHaveBeenCalledWith('open');
  });

  it('reset() regresa el estado a closed y limpia contador', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const cb = new CircuitBreaker(fn, { failureThreshold: 2 });

    await expect(cb.execute()).rejects.toThrow();
    await expect(cb.execute()).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');

    fn.mockResolvedValueOnce('ok');
    await expect(cb.execute()).resolves.toBe('ok');
  });
});
