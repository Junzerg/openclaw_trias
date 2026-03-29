/**
 * OpenClaw Error Classification — Unified error types for LLM / Gateway / CLI failures
 *
 * Task 3.2: Provides a centralized enum of error types with retryable/non-retryable
 * classification, consumed by `withRetry()` and downstream pipeline stages.
 */

// ─── Error Types ─────────────────────────────────────────────────────────────

export enum OpenClawErrorType {
  // ── Retryable ──
  LLM_TIMEOUT        = 'LLM_TIMEOUT',
  LLM_RATE_LIMIT     = 'LLM_RATE_LIMIT',
  JSON_PARSE_ERROR   = 'JSON_PARSE_ERROR',
  GATEWAY_DISCONNECT = 'GATEWAY_DISCONNECT',

  // ── Non-retryable ──
  MODEL_NOT_FOUND      = 'MODEL_NOT_FOUND',
  SKILL_NOT_AVAILABLE  = 'SKILL_NOT_AVAILABLE',
  AUTH_FAILED          = 'AUTH_FAILED',
  CODE_EXECUTION_CRASH = 'CODE_EXEC_CRASH',
  CONTENT_FILTERED     = 'CONTENT_FILTERED',
}

// ─── Retryable Set ───────────────────────────────────────────────────────────

const RETRYABLE_TYPES = new Set<OpenClawErrorType>([
  OpenClawErrorType.LLM_TIMEOUT,
  OpenClawErrorType.LLM_RATE_LIMIT,
  OpenClawErrorType.JSON_PARSE_ERROR,
  OpenClawErrorType.GATEWAY_DISCONNECT,
]);

// ─── Error Class ─────────────────────────────────────────────────────────────

export class OpenClawError extends Error {
  readonly type: OpenClawErrorType;
  readonly retryable: boolean;

  constructor(type: OpenClawErrorType, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenClawError';
    this.type = type;
    this.retryable = RETRYABLE_TYPES.has(type);
  }
}

// ─── Classification Helpers ──────────────────────────────────────────────────

/**
 * Pattern table used by `classifyOutputError` to detect error types from CLI output.
 * Patterns are tested against individual **cleaned** lines (after ANSI / banner stripping).
 * Order matters: first match wins.
 */
const OUTPUT_PATTERNS: Array<{ test: (line: string) => boolean; type: OpenClawErrorType }> = [
  // Gateway disconnection
  {
    test: (l) => l.startsWith('gateway connect failed') ||
                 l.startsWith('Gateway agent failed; falling back to embedded') ||
                 (l.startsWith('Error:') && l.includes('gateway closed')),
    type: OpenClawErrorType.GATEWAY_DISCONNECT,
  },
  // Rate limiting — require error-adjacent context for all sub-patterns.
  // 'response' removed from rate.?limit context because it triggers on
  // LLM content like "rate-limit headers with 200 response".
  {
    test: (l) => (/rate.?limit/i.test(l) &&
                  /\b(error|http|status|exceeded|429)\b/i.test(l)) ||
                 (/\b429\b/.test(l) && /\b(error|http|status|response)\b/i.test(l)) ||
                 /too many requests/i.test(l),
    type: OpenClawErrorType.LLM_RATE_LIMIT,
  },
  // Timeout — require a SEPARATE error-context word to avoid false positives
  // from LLM content discussing timeout concepts (e.g. "Set a timeout of 30 seconds").
  // `after\s+\d` is tested separately to avoid \b word-boundary issues with digits.
  {
    test: (l) => /\btimeout\b/i.test(l) &&
                 (/\b(error|failed|exceeded|kill|CLI)\b/i.test(l) ||
                  /after\s+\d/i.test(l)),
    type: OpenClawErrorType.LLM_TIMEOUT,
  },
  // Model not found — require error/line-start context to avoid false positives
  // from LLM content discussing model concepts (e.g. "invalid model of computation").
  {
    test: (l) => (/model.?not.?found/i.test(l) &&
                  /\b(error|failed|unknown|unsupported)\b/i.test(l) ||
                  l.toLowerCase().startsWith('error:') && /model.?not.?found/i.test(l)) ||
                 (/invalid.?model/i.test(l) &&
                  /\b(error|specified|id|name)\b/i.test(l)),
    type: OpenClawErrorType.MODEL_NOT_FOUND,
  },
  // Content filtered — require error-adjacent context to avoid false positives
  // from LLM content that casually mentions "safety" or "content filter".
  {
    test: (l) => (/content.?filter/i.test(l) &&
                  /\b(error|blocked|triggered|rejected|moderation|policy|violation)\b/i.test(l)) ||
                 /\bsafety\s+(filter|block|violation|flag)/i.test(l) ||
                 (/\bsafety\b/i.test(l) && /\b(blocked|rejected|refused|error)\b/i.test(l)),
    type: OpenClawErrorType.CONTENT_FILTERED,
  },
  // Authentication — require HTTP/Error context for "unauthorized".
  // Use 4\d{2} to match 4xx HTTP status codes only (not arbitrary 3-digit numbers).
  {
    test: (l) => (/\bunauthorized\b/i.test(l) &&
                  /\b(4\d{2}|error|http|status|response|failed)\b/i.test(l)) ||
                 /invalid.?api.?key/i.test(l),
    type: OpenClawErrorType.AUTH_FAILED,
  },
];

/**
 * Classify an error from CLI/Gateway output lines.
 * Returns `null` if no known error pattern is matched.
 */
export function classifyOutputError(cleanLines: string[]): OpenClawErrorType | null {
  for (const line of cleanLines) {
    const trimmed = line.trim();
    for (const pattern of OUTPUT_PATTERNS) {
      if (pattern.test(trimmed)) {
        return pattern.type;
      }
    }
  }
  return null;
}
