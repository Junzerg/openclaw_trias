/**
 * Tests for withRetry — Task 3.2
 *
 * Uses vi.useFakeTimers() to validate backoff delays without real waits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawError, OpenClawErrorType } from '../../src/openclaw/errors.js';
import {
  withRetry,
  computeDelay,
  type RetryConfig,
} from '../../src/openclaw/retry.js';

// ─── computeDelay ────────────────────────────────────────────────────────────

describe('computeDelay', () => {
  it('immediate → always 0', () => {
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'immediate', baseDelayMs: 999 };
    expect(computeDelay(cfg, 1)).toBe(0);
    expect(computeDelay(cfg, 2)).toBe(0);
    expect(computeDelay(cfg, 3)).toBe(0);
  });

  it('fixed → always baseDelayMs', () => {
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'fixed', baseDelayMs: 3000 };
    expect(computeDelay(cfg, 1)).toBe(3000);
    expect(computeDelay(cfg, 2)).toBe(3000);
    expect(computeDelay(cfg, 3)).toBe(3000);
  });

  it('exponential → doubles each attempt', () => {
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'exponential', baseDelayMs: 2000 };
    expect(computeDelay(cfg, 1)).toBe(2000);  // 2000 * 2^0
    expect(computeDelay(cfg, 2)).toBe(4000);  // 2000 * 2^1
    expect(computeDelay(cfg, 3)).toBe(8000);  // 2000 * 2^2
  });

  it('exponential → caps at maxDelayMs', () => {
    const cfg: RetryConfig = { maxRetries: 5, backoff: 'exponential', baseDelayMs: 2000, maxDelayMs: 5000 };
    expect(computeDelay(cfg, 1)).toBe(2000);  // 2000 * 2^0 = 2000 < 5000
    expect(computeDelay(cfg, 2)).toBe(4000);  // 2000 * 2^1 = 4000 < 5000
    expect(computeDelay(cfg, 3)).toBe(5000);  // 2000 * 2^2 = 8000 → capped to 5000
    expect(computeDelay(cfg, 4)).toBe(5000);  // 2000 * 2^3 = 16000 → capped to 5000
  });

  it('exponential → defaults to 30s cap without maxDelayMs', () => {
    const cfg: RetryConfig = { maxRetries: 20, backoff: 'exponential', baseDelayMs: 2000 };
    // 2000 * 2^14 = 32,768,000 → should be capped to 30,000
    expect(computeDelay(cfg, 15)).toBe(30_000);
  });
});

// ─── withRetry ───────────────────────────────────────────────────────────────

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success (no retries)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'immediate', baseDelayMs: 0 };

    const result = await withRetry(fn, cfg);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'timeout'))
      .mockResolvedValueOnce('recovered');

    const cfg: RetryConfig = { maxRetries: 2, backoff: 'immediate', baseDelayMs: 0 };
    const result = await withRetry(fn, cfg);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and throws last error', async () => {
    const err1 = new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'timeout 1');
    const err2 = new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'timeout 2');
    const err3 = new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'timeout 3');
    const fn = vi.fn()
      .mockRejectedValueOnce(err1)
      .mockRejectedValueOnce(err2)
      .mockRejectedValueOnce(err3);

    const cfg: RetryConfig = { maxRetries: 2, backoff: 'immediate', baseDelayMs: 0 };
    await expect(withRetry(fn, cfg)).rejects.toThrow('timeout 3');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('immediately rethrows non-retryable OpenClawError', async () => {
    const err = new OpenClawError(OpenClawErrorType.AUTH_FAILED, 'bad key');
    const fn = vi.fn().mockRejectedValue(err);

    const cfg: RetryConfig = { maxRetries: 3, backoff: 'immediate', baseDelayMs: 0 };
    await expect(withRetry(fn, cfg)).rejects.toThrow('bad key');
    expect(fn).toHaveBeenCalledTimes(1); // no retries
  });

  it('immediately rethrows non-OpenClawError', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('unexpected'));

    const cfg: RetryConfig = { maxRetries: 3, backoff: 'immediate', baseDelayMs: 0 };
    await expect(withRetry(fn, cfg)).rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('logs structured retry messages', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'to'))
      .mockResolvedValueOnce('ok');

    const logs: string[] = [];
    const cfg: RetryConfig = { maxRetries: 2, backoff: 'exponential', baseDelayMs: 2000 };

    // Wrap in a helper that advances timers on await
    const promise = withRetry(fn, cfg, (msg) => logs.push(msg));
    // Advance timers to let the sleep resolve
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe('[Retry] attempt 2/3 for LLM_TIMEOUT (delay: 2000ms)');
  });

  it('applies exponential backoff delays', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.LLM_RATE_LIMIT, 'rl'))
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.LLM_RATE_LIMIT, 'rl'))
      .mockResolvedValueOnce('ok');

    const logs: string[] = [];
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'exponential', baseDelayMs: 1000 };

    const promise = withRetry(fn, cfg, (msg) => logs.push(msg));
    // First retry: 1000ms delay
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry: 2000ms delay
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('delay: 1000ms');
    expect(logs[1]).toContain('delay: 2000ms');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects retryOn filter — skips retry for non-matching type', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new OpenClawError(OpenClawErrorType.GATEWAY_DISCONNECT, 'disc'));

    const cfg: RetryConfig = {
      maxRetries: 3,
      backoff: 'immediate',
      baseDelayMs: 0,
      retryOn: [OpenClawErrorType.LLM_TIMEOUT], // only retry timeouts
    };

    await expect(withRetry(fn, cfg)).rejects.toThrow('disc');
    expect(fn).toHaveBeenCalledTimes(1); // no retry — type not in retryOn
  });

  it('respects retryOn filter — retries matching type', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'to'))
      .mockResolvedValueOnce('ok');

    const cfg: RetryConfig = {
      maxRetries: 2,
      backoff: 'immediate',
      baseDelayMs: 0,
      retryOn: [OpenClawErrorType.LLM_TIMEOUT],
    };

    const result = await withRetry(fn, cfg);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('immediate backoff has zero delay', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.JSON_PARSE_ERROR, 'bad json'))
      .mockResolvedValueOnce('ok');

    const logs: string[] = [];
    const cfg: RetryConfig = { maxRetries: 2, backoff: 'immediate', baseDelayMs: 0 };
    const result = await withRetry(fn, cfg, (msg) => logs.push(msg));

    expect(result).toBe('ok');
    expect(logs[0]).toBe('[Retry] attempt 2/3 for JSON_PARSE_ERROR');
    // No "(delay: ...)" suffix for immediate backoff
    expect(logs[0]).not.toContain('delay');
  });

  it('fixed backoff uses same delay each time', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.GATEWAY_DISCONNECT, 'd'))
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.GATEWAY_DISCONNECT, 'd'))
      .mockResolvedValueOnce('ok');

    const logs: string[] = [];
    const cfg: RetryConfig = { maxRetries: 3, backoff: 'fixed', baseDelayMs: 500 };

    const promise = withRetry(fn, cfg, (msg) => logs.push(msg));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(logs[0]).toContain('delay: 500ms');
    expect(logs[1]).toContain('delay: 500ms');
  });

  it('maxRetries=0 means try once, no retry', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'to'));

    const cfg: RetryConfig = { maxRetries: 0, backoff: 'immediate', baseDelayMs: 0 };
    await expect(withRetry(fn, cfg)).rejects.toThrow('to');
    expect(fn).toHaveBeenCalledTimes(1); // just the initial call, no retries
  });

  it('handles error type changing between retries', async () => {
    // First attempt: retryable JSON_PARSE_ERROR → retry
    // Second attempt: non-retryable MODEL_NOT_FOUND → immediate rethrow
    const fn = vi.fn()
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.JSON_PARSE_ERROR, 'bad json'))
      .mockRejectedValueOnce(new OpenClawError(OpenClawErrorType.MODEL_NOT_FOUND, 'no model'));

    const cfg: RetryConfig = { maxRetries: 3, backoff: 'immediate', baseDelayMs: 0 };
    await expect(withRetry(fn, cfg)).rejects.toSatisfy((err: unknown) => {
      return err instanceof OpenClawError &&
             err.type === OpenClawErrorType.MODEL_NOT_FOUND; // stops immediately
    });
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry, then stopped
  });
});

// ─── getRetryConfigForType ───────────────────────────────────────────────────

import { getRetryConfigForType, FALLBACK_RETRY_CONFIG } from '../../src/openclaw/retry.js';

describe('getRetryConfigForType', () => {
  it('returns specific config for known retryable types', () => {
    const cfg = getRetryConfigForType(OpenClawErrorType.LLM_TIMEOUT);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.backoff).toBe('exponential');
    expect(cfg.baseDelayMs).toBe(2000);
  });

  it('returns FALLBACK_RETRY_CONFIG for unknown/non-retryable types', () => {
    const cfg = getRetryConfigForType(OpenClawErrorType.AUTH_FAILED);
    expect(cfg).toBe(FALLBACK_RETRY_CONFIG);
    expect(cfg.maxRetries).toBe(1);
    expect(cfg.backoff).toBe('fixed');
  });
});
