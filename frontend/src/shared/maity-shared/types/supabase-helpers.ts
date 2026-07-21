/**
 * Type-Safe Supabase Helpers
 *
 * Collection of utility types and functions for working with Supabase
 * in a type-safe manner with strict mode enabled.
 */

/**
 * Type-safe wrapper for Supabase RPC responses
 */
export type SupabaseResponse<T> = {
  data: T | null;
  error: Error | null;
};

/**
 * Type guard for checking if value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Safe error message extractor
 * Handles various error types and returns a user-friendly message
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return 'An unexpected error occurred';
}

/**
 * Type-safe array helper
 * Converts null/undefined values to empty arrays
 */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Safe null coalescing for objects
 * Returns the value or a default if null/undefined
 */
export function defaultValue<T>(value: T | null | undefined, defaultVal: T): T {
  return value ?? defaultVal;
}

/**
 * Type guard for checking if an object has a specific property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return typeof obj === 'object' && obj !== null && key in obj;
}

/**
 * Type guard for PostgreSQL error
 */
export interface PostgrestError {
  message: string;
  details: string;
  hint: string;
  code: string;
}

export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    'code' in error
  );
}

/**
 * Helper to safely extract data from Supabase response
 * Throws if error exists, returns data or default
 */
export function extractData<T>(
  response: { data: T | null; error: unknown },
  defaultValue: T
): T;
export function extractData<T>(
  response: { data: T | null; error: unknown }
): T | null;
export function extractData<T>(
  response: { data: T | null; error: unknown },
  defaultValue?: T
): T | null {
  if (response.error) {
    throw new Error(getErrorMessage(response.error));
  }

  if (defaultValue !== undefined) {
    return response.data ?? defaultValue;
  }

  return response.data;
}

/**
 * Type-safe assertion that a value is not null
 * Throws if value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string = 'Expected value to be defined'
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(
  json: string,
  fallback: T
): T {
  try {
    const parsed = JSON.parse(json);
    return parsed as T;
  } catch {
    return fallback;
  }
}
