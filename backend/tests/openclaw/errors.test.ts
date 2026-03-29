/**
 * Tests for OpenClaw Error Classification — Task 3.2
 */

import { describe, it, expect } from 'vitest';
import {
  OpenClawError,
  OpenClawErrorType,
  classifyOutputError,
} from '../../src/openclaw/errors.js';

// ─── OpenClawError ───────────────────────────────────────────────────────────

describe('OpenClawError', () => {
  describe('retryable types', () => {
    const retryableTypes = [
      OpenClawErrorType.LLM_TIMEOUT,
      OpenClawErrorType.LLM_RATE_LIMIT,
      OpenClawErrorType.JSON_PARSE_ERROR,
      OpenClawErrorType.GATEWAY_DISCONNECT,
    ];

    for (const type of retryableTypes) {
      it(`${type} → retryable=true`, () => {
        const err = new OpenClawError(type, `test ${type}`);
        expect(err.retryable).toBe(true);
        expect(err.type).toBe(type);
        expect(err.name).toBe('OpenClawError');
      });
    }
  });

  describe('non-retryable types', () => {
    const nonRetryableTypes = [
      OpenClawErrorType.MODEL_NOT_FOUND,
      OpenClawErrorType.SKILL_NOT_AVAILABLE,
      OpenClawErrorType.AUTH_FAILED,
      OpenClawErrorType.CODE_EXECUTION_CRASH,
      OpenClawErrorType.CONTENT_FILTERED,
    ];

    for (const type of nonRetryableTypes) {
      it(`${type} → retryable=false`, () => {
        const err = new OpenClawError(type, `test ${type}`);
        expect(err.retryable).toBe(false);
        expect(err.type).toBe(type);
      });
    }
  });

  it('carries message and cause', () => {
    const cause = new Error('root cause');
    const err = new OpenClawError(OpenClawErrorType.LLM_TIMEOUT, 'timed out', { cause });
    expect(err.message).toBe('timed out');
    expect(err.cause).toBe(cause);
  });

  it('is an instance of Error', () => {
    const err = new OpenClawError(OpenClawErrorType.AUTH_FAILED, 'bad key');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenClawError);
  });
});

// ─── classifyOutputError ─────────────────────────────────────────────────────

describe('classifyOutputError', () => {
  it('detects GATEWAY_DISCONNECT from "gateway connect failed"', () => {
    const lines = ['gateway connect failed: ECONNREFUSED'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.GATEWAY_DISCONNECT);
  });

  it('detects GATEWAY_DISCONNECT from "Error: gateway closed"', () => {
    const lines = ['Error: gateway closed unexpectedly'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.GATEWAY_DISCONNECT);
  });

  it('detects GATEWAY_DISCONNECT from fallback message', () => {
    const lines = ['Gateway agent failed; falling back to embedded agent'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.GATEWAY_DISCONNECT);
  });

  it('detects LLM_RATE_LIMIT from "429" with HTTP context', () => {
    const lines = ['HTTP 429 - rate limit exceeded'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.LLM_RATE_LIMIT);
  });

  it('detects LLM_RATE_LIMIT from "rate limit" with error context', () => {
    const lines = ['Error: rate limit exceeded for model gpt-4'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.LLM_RATE_LIMIT);
  });

  it('does NOT false-positive on casual mention of "rate limiting"', () => {
    const lines = ['You should implement rate limiting in your API gateway.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('detects LLM_RATE_LIMIT from "too many requests"', () => {
    const lines = ['Error: Too Many Requests - please slow down'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.LLM_RATE_LIMIT);
  });

  it('detects LLM_TIMEOUT', () => {
    const lines = ['Request timeout after 120s'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.LLM_TIMEOUT);
  });

  it('does NOT false-positive on casual mention of "timeout"', () => {
    const lines = ['Set a timeout of 30 seconds for the connection pool.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('detects MODEL_NOT_FOUND', () => {
    const lines = ['Error: model not found: gpt-99'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.MODEL_NOT_FOUND);
  });

  it('detects MODEL_NOT_FOUND from "invalid model specified"', () => {
    const lines = ['invalid model specified'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.MODEL_NOT_FOUND);
  });

  it('does NOT false-positive on "model not found" in casual content', () => {
    const lines = ['Read about model_not_found in the documentation.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('does NOT false-positive on "invalid model" in non-error context', () => {
    const lines = ['This is an invalid model of computation.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('detects CONTENT_FILTERED from "content_filter"', () => {
    const lines = ['content_filter triggered by moderation API'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.CONTENT_FILTERED);
  });

  it('does NOT false-positive on casual mention of "content filter"', () => {
    const lines = ['The content filter in the email system blocks spam.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('detects CONTENT_FILTERED from "safety blocked"', () => {
    const lines = ['Response blocked for safety reasons'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.CONTENT_FILTERED);
  });

  it('does NOT false-positive on casual mention of "safety"', () => {
    const lines = ['We prioritize safety in our engineering practices.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('detects AUTH_FAILED from "unauthorized"', () => {
    const lines = ['401 Unauthorized'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.AUTH_FAILED);
  });

  it('detects AUTH_FAILED from "invalid api key"', () => {
    const lines = ['Error: invalid api key provided'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.AUTH_FAILED);
  });

  it('does NOT false-positive on casual mention of "unauthorized"', () => {
    const lines = ['The user made an unauthorized copy of the document.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('returns null for clean output', () => {
    const lines = ['Hello, this is a normal LLM response.', 'It has multiple lines.'];
    expect(classifyOutputError(lines)).toBeNull();
  });

  it('returns null for empty lines', () => {
    expect(classifyOutputError([])).toBeNull();
  });

  it('pattern priority: rate-limit wins over timeout when both match', () => {
    // "Error: rate limit timeout" contains both rate-limit and timeout keywords.
    // Rate limit pattern is checked before timeout → should return LLM_RATE_LIMIT.
    const lines = ['Error: rate limit timeout exceeded'];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.LLM_RATE_LIMIT);
  });

  it('scans multiple lines — returns first match from any line', () => {
    const lines = [
      'Normal output line 1',
      'Normal output line 2',
      'Error: model not found: gpt-99',  // ← error on line 3
    ];
    expect(classifyOutputError(lines)).toBe(OpenClawErrorType.MODEL_NOT_FOUND);
  });
});
