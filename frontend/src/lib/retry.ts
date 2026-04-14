/**
 * Retry Utility Module
 *
 * Provides retry logic with exponential backoff for handling transient failures
 * in network requests, API calls, and other async operations.
 */

import { logger } from '@/lib/logger';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to delay (default: true) */
  jitter?: boolean;
  /** Function to determine if error is retryable (default: all errors are retryable) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback called before each retry attempt */
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  /** Abort signal to cancel retries */
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal' | 'onRetry' | 'isRetryable'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Error thrown when all retry attempts have been exhausted
 */
export class RetryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    const message = lastError instanceof Error
      ? `Retry exhausted after ${attempts} attempts: ${lastError.message}`
      : `Retry exhausted after ${attempts} attempts`;

    super(message);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

/**
 * Calculate delay for exponential backoff with optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitter: boolean
): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelay);

  // Add jitter (0-50% of delay)
  if (jitter) {
    delay = delay * (1 + Math.random() * 0.5);
  }

  return Math.round(delay);
}

/**
 * Default function to determine if an error is retryable
 * Network errors and 5xx HTTP errors are typically retryable
 */
function defaultIsRetryable(error: unknown): boolean {
  // Always retry on unknown errors
  if (!(error instanceof Error)) return true;

  const message = error.message.toLowerCase();

  // Network errors - should retry
  const networkErrors = [
    'network error',
    'failed to fetch',
    'net::err',
    'econnrefused',
    'econnreset',
    'enotfound',
    'etimedout',
    'socket hang up',
    'connection refused',
  ];

  if (networkErrors.some(e => message.includes(e))) {
    return true;
  }

  // HTTP status errors - check status code
  const statusMatch = message.match(/status[:\s]*(\d+)/i);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    // Retry on server errors (5xx) and some client errors
    if (status >= 500 || status === 429 || status === 408) {
      return true;
    }
    // Don't retry on client errors (4xx except 429, 408)
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Retry on timeout errors
  if (message.includes('timeout')) {
    return true;
  }

  // Default to retryable
  return true;
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects after all retries exhausted
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await withRetry(async () => {
 *   return await fetchData();
 * });
 *
 * // With custom options
 * const result = await withRetry(
 *   async () => await fetchData(),
 *   {
 *     maxRetries: 5,
 *     initialDelay: 500,
 *     onRetry: (attempt, error) => {
 *       logger.debug(`Retry attempt ${attempt} after error:`, error);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    initialDelay = DEFAULT_OPTIONS.initialDelay,
    maxDelay = DEFAULT_OPTIONS.maxDelay,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    jitter = DEFAULT_OPTIONS.jitter,
    isRetryable = defaultIsRetryable,
    onRetry,
    signal,
  } = options;

  let lastError: unknown;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      // Check if we should retry
      if (attempt > maxRetries || !isRetryable(error)) {
        break;
      }

      // Calculate delay for this attempt
      const delay = calculateDelay(
        attempt - 1,
        initialDelay,
        maxDelay,
        backoffMultiplier,
        jitter
      );

      // Call onRetry callback
      if (onRetry) {
        try {
          onRetry(attempt, error, delay);
        } catch (callbackError) {
          console.error('[Retry] onRetry callback error:', callbackError);
        }
      }

      // Log retry attempt
      logger.debug(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`, error);

      // Wait before retrying
      await sleep(delay, signal);
    }
  }

  throw new RetryExhaustedError(attempt, lastError);
}

/**
 * Create a retryable version of an async function
 *
 * @param fn - Async function to make retryable
 * @param options - Retry configuration options
 * @returns New function that will retry on failure
 *
 * @example
 * ```ts
 * const fetchWithRetry = makeRetryable(fetchData, { maxRetries: 3 });
 * const result = await fetchWithRetry(arg1, arg2);
 * ```
 */
export function makeRetryable<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Retry decorator for class methods
 * Note: This works with TypeScript decorators (requires experimentalDecorators)
 *
 * @param options - Retry configuration options
 * @returns Method decorator
 *
 * @example
 * ```ts
 * class ApiService {
 *   @retry({ maxRetries: 3 })
 *   async fetchData() {
 *     return await fetch('/api/data');
 *   }
 * }
 * ```
 */
export function retry(options: RetryOptions = {}) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return withRetry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}

/**
 * Check if an error is a RetryExhaustedError
 */
export function isRetryExhaustedError(error: unknown): error is RetryExhaustedError {
  return error instanceof RetryExhaustedError;
}

/**
 * Utility to create a circuit breaker pattern
 * Opens the circuit after consecutive failures, preventing further calls
 */
export class CircuitBreaker<T> {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly fn: () => Promise<T>,
    private readonly options: {
      failureThreshold?: number;
      resetTimeout?: number;
      onStateChange?: (state: 'closed' | 'open' | 'half-open') => void;
    } = {}
  ) {}

  async execute(): Promise<T> {
    const { failureThreshold = 5, resetTimeout = 30000 } = this.options;

    // Check if circuit should be half-open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= resetTimeout) {
        this.setState('half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await this.fn();

      // Success - reset failures
      this.failures = 0;
      if (this.state !== 'closed') {
        this.setState('closed');
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // Check if we should open the circuit
      if (this.failures >= failureThreshold) {
        this.setState('open');
      }

      throw error;
    }
  }

  private setState(newState: 'closed' | 'open' | 'half-open') {
    if (this.state !== newState) {
      this.state = newState;
      this.options.onStateChange?.(newState);
      logger.debug(`[CircuitBreaker] State changed to: ${newState}`);
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  reset() {
    this.failures = 0;
    this.setState('closed');
  }
}
