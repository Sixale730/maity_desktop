/**
 * Tauri Invoke with Retry
 *
 * Wrapper around Tauri's invoke API that adds automatic retry logic
 * with exponential backoff for handling transient failures.
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { withRetry, RetryOptions, isRetryExhaustedError } from './retry';

export interface InvokeRetryOptions extends RetryOptions {
  /** Show toast notification on final failure (default: false) */
  showErrorToast?: boolean;
  /** Custom error message for toast */
  errorMessage?: string;
}

/**
 * Default options for Tauri invoke retry
 */
const DEFAULT_INVOKE_OPTIONS: InvokeRetryOptions = {
  maxRetries: 2,
  initialDelay: 500,
  maxDelay: 5000,
  jitter: true,
  showErrorToast: false,
};

/**
 * Determine if a Tauri invoke error is retryable
 */
function isTauriErrorRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  // Don't retry on validation/auth errors
  const nonRetryablePatterns = [
    'invalid',
    'unauthorized',
    'forbidden',
    'not found',
    'permission denied',
    'already exists',
    'conflict',
  ];

  if (nonRetryablePatterns.some(p => message.includes(p))) {
    return false;
  }

  // Retry on transient errors
  const retryablePatterns = [
    'timeout',
    'busy',
    'temporarily',
    'unavailable',
    'connection',
    'network',
    'failed to',
  ];

  return retryablePatterns.some(p => message.includes(p));
}

/**
 * Invoke a Tauri command with automatic retry logic
 *
 * @param cmd - The Tauri command name
 * @param args - Optional arguments to pass to the command
 * @param options - Retry configuration options
 * @returns Promise that resolves with the command result
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await invokeWithRetry('get_settings');
 *
 * // With arguments
 * const meeting = await invokeWithRetry('get_meeting', { id: '123' });
 *
 * // With custom retry options
 * const data = await invokeWithRetry('slow_operation', {}, {
 *   maxRetries: 5,
 *   initialDelay: 1000,
 *   onRetry: (attempt) => logger.debug(`Retrying... (${attempt})`),
 * });
 * ```
 */
export async function invokeWithRetry<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options: InvokeRetryOptions = {}
): Promise<T> {
  const mergedOptions = {
    ...DEFAULT_INVOKE_OPTIONS,
    ...options,
    isRetryable: options.isRetryable ?? isTauriErrorRetryable,
  };

  const { showErrorToast, errorMessage, ...retryOptions } = mergedOptions;

  try {
    return await withRetry(
      () => invoke<T>(cmd, args),
      {
        ...retryOptions,
        onRetry: (attempt, error, delay) => {
          logger.debug(`[invokeWithRetry] Command "${cmd}" failed, attempt ${attempt}, retrying in ${delay}ms...`, error);
          retryOptions.onRetry?.(attempt, error, delay);
        },
      }
    );
  } catch (error) {
    // Log the final error
    console.error(`[invokeWithRetry] Command "${cmd}" failed after all retries:`, error);

    // Show toast if requested
    if (showErrorToast) {
      try {
        // Dynamic import to avoid circular dependencies
        const { toast } = await import('sonner');
        const message = errorMessage
          || (isRetryExhaustedError(error)
            ? `La operación falló después de ${error.attempts} intentos`
            : 'La operación falló');
        toast.error(message);
      } catch (toastError) {
        console.error('[invokeWithRetry] Failed to show error toast:', toastError);
      }
    }

    throw error;
  }
}

/**
 * Create a pre-configured invoke function for a specific command
 *
 * @param cmd - The Tauri command name
 * @param defaultOptions - Default retry options for this command
 * @returns Function that invokes the command with retry
 *
 * @example
 * ```ts
 * const fetchMeetings = createRetryableInvoke<Meeting[]>('get_meetings', {
 *   maxRetries: 3,
 *   showErrorToast: true,
 * });
 *
 * const meetings = await fetchMeetings();
 * const filtered = await fetchMeetings({ filter: 'today' });
 * ```
 */
export function createRetryableInvoke<T>(
  cmd: string,
  defaultOptions: InvokeRetryOptions = {}
) {
  return (args?: Record<string, unknown>, options?: InvokeRetryOptions) =>
    invokeWithRetry<T>(cmd, args, { ...defaultOptions, ...options });
}

/**
 * Pre-configured invoke functions for common operations
 */
export const retryableInvoke = {
  /**
   * Get meeting data with retry
   */
  getMeeting: createRetryableInvoke<{
    id: string;
    title: string;
    transcript: string;
    summary: string;
    created_at: string;
  }>('get_meeting', { maxRetries: 2 }),

  /**
   * Get all meetings with retry
   */
  getMeetings: createRetryableInvoke<Array<{
    id: string;
    title: string;
    created_at: string;
  }>>('get_all_meetings', { maxRetries: 2 }),

  /**
   * Save meeting with retry
   */
  saveMeeting: createRetryableInvoke<void>('save_meeting', {
    maxRetries: 3,
    showErrorToast: true,
    errorMessage: 'Error al guardar la reunión',
  }),

  /**
   * Get transcript history with retry
   */
  getTranscriptHistory: createRetryableInvoke<Array<{
    text: string;
    timestamp: number;
  }>>('get_transcript_history', { maxRetries: 2 }),

  /**
   * Get settings with retry
   */
  getSettings: createRetryableInvoke<Record<string, unknown>>('get_settings', {
    maxRetries: 2,
  }),
};

export { isRetryExhaustedError };
