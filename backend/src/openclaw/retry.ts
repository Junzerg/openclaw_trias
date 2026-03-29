/**
 * Generic Retry Decorator — withRetry<T>
 *
 * Task 3.2: Provides configurable retry logic with exponential/fixed/immediate
 * backoff, structured logging, and per-error-type retry configs.
 */

import { OpenClawError, OpenClawErrorType } from './errors.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retry attempts (does NOT include the initial call). */
  maxRetries: number;
  /** Backoff strategy: 'fixed' | 'exponential' | 'immediate' */
  backoff: 'fixed' | 'exponential' | 'immediate';
  /** Base delay in milliseconds. Doubled each attempt for exponential. Ignored for 'immediate'. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential growth). Default: 30000 (30s). */
  maxDelayMs?: number;
  /** If set, only retry these specific error types. Empty/undefined = all retryable types. */
  retryOn?: OpenClawErrorType[];
}

// ─── Default Retry Configs ───────────────────────────────────────────────────

export const DEFAULT_RETRY_CONFIGS: Record<string, RetryConfig> = {
  [OpenClawErrorType.LLM_TIMEOUT]:        { maxRetries: 2, backoff: 'exponential', baseDelayMs: 2000 },
  [OpenClawErrorType.JSON_PARSE_ERROR]:    { maxRetries: 2, backoff: 'immediate',   baseDelayMs: 0 },
  [OpenClawErrorType.LLM_RATE_LIMIT]:      { maxRetries: 3, backoff: 'exponential', baseDelayMs: 5000 },
  [OpenClawErrorType.GATEWAY_DISCONNECT]:  { maxRetries: 1, backoff: 'fixed',       baseDelayMs: 3000 },
};

/**
 * Fallback config used when no specific config is found for an error type.
 * Conservative: 1 retry with 2s fixed delay.
 */
export const FALLBACK_RETRY_CONFIG: RetryConfig = {
  maxRetries: 1,
  backoff: 'fixed',
  baseDelayMs: 2000,
};

// ─── Sleep Helper ────────────────────────────────────────────────────────────

/** Awaitable delay — extracted so tests can use `vi.useFakeTimers()`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default maximum delay cap for exponential backoff (30 seconds). */
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Calculate the delay for a given attempt based on the backoff strategy.
 * @param attempt - 1-indexed attempt number (1 = first retry)
 */
export function computeDelay(config: RetryConfig, attempt: number): number {
  switch (config.backoff) {
    case 'immediate':
      return 0;
    case 'fixed':
      return config.baseDelayMs;
    case 'exponential': {
      // attempt 1 → baseDelay, attempt 2 → baseDelay * 2, etc.
      const raw = config.baseDelayMs * Math.pow(2, attempt - 1);
      const cap = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
      return Math.min(raw, cap);
    }
  }
}

// ─── withRetry ───────────────────────────────────────────────────────────────

/**
 * Execute `fn` with automatic retries for retryable `OpenClawError`s.
 *
 * - Non-`OpenClawError` exceptions → immediate rethrow (unknown errors)
 * - `OpenClawError` with `retryable=false` → immediate rethrow
 * - `OpenClawError` with `retryable=true` → retry up to `config.maxRetries` times
 *
 * @param fn     - The async operation to retry
 * @param config - Retry strategy configuration
 * @param logger - Optional structured logger for retry events
 * @returns The result of `fn` on success
 * @throws The last `OpenClawError` after all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  logger?: (msg: string) => void,
): Promise<T> {
  let lastError: OpenClawError | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Non-OpenClawError → immediate rethrow (unknown/unexpected)
      if (!(err instanceof OpenClawError)) {
        throw err;
      }

      // Non-retryable OpenClawError → immediate rethrow
      if (!err.retryable) {
        throw err;
      }

      // Check retryOn filter (if configured)
      if (config.retryOn && config.retryOn.length > 0 && !config.retryOn.includes(err.type)) {
        throw err;
      }

      lastError = err;

      // If this was the last allowed attempt, break out to throw
      if (attempt >= config.maxRetries) {
        break;
      }

      // Calculate delay and wait
      const delay = computeDelay(config, attempt + 1);
      // Log format matches spec: "[Retry] attempt 2/3 for LLM_TIMEOUT (delay: 4000ms)"
      // attempt+2 = 1-indexed attempt number (attempt 0 catch = 2nd total try)
      // maxRetries+1 = total number of tries
      logger?.(
        `[Retry] attempt ${attempt + 2}/${config.maxRetries + 1} for ${err.type}` +
        (delay > 0 ? ` (delay: ${delay}ms)` : ''),
      );

      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — throw the last error
  throw lastError!;
}

/**
 * Resolve the retry config for a given error type, falling back to FALLBACK_RETRY_CONFIG.
 */
export function getRetryConfigForType(type: OpenClawErrorType): RetryConfig {
  return DEFAULT_RETRY_CONFIGS[type] ?? FALLBACK_RETRY_CONFIG;
}
