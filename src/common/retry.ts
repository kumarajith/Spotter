export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Return false to rethrow immediately instead of retrying. Defaults to retrying everything. */
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Retries an async operation with exponential backoff.
 * Designed for transient database / network failures — replaces
 * the automatic retry resilience previously provided by SQS (maxReceiveCount: 3).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 100, shouldRetry = () => true }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err)) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
