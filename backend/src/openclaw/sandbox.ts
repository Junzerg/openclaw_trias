/**
 * Security Sandbox — L2 Layer Pre-checks (Task 3.6)
 *
 * Lightweight security validation before code is sent to the OpenClaw Gateway
 * for execution. This is the second line of defense (L2); the Gateway's
 * built-in sandbox (L1) provides the ultimate resource/timeout constraints.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum code length in characters (10 KB). */
const MAX_CODE_LENGTH = 10 * 1024;

/** Default maximum output size in bytes (50 KB). */
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;

/** Patterns that indicate clearly destructive system commands. */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // rm: catch evasion variants like r\m -rf, r"m" -rf, rm /* -rf
  { pattern: /\br[\\'"]*m[\\'"]*(?:\s+.*?)?\s+-[a-zA-Z]*[rf][a-zA-Z]*\b/i, label: 'rm -rf (evasion)' },
  { pattern: /\br[\\'"]*m[\\'"]*\s+(-[-a-zA-Z]+\s+)*\//i, label: 'rm -rf / (evasion)' },
  { pattern: /mkfs\b/, label: 'mkfs (格式化磁盘)' },
  { pattern: /dd\s+if=/, label: 'dd (磁盘写入)' },
  // decoder to shell exploits
  { pattern: /\bbase64\b\s+(?:-d|--decode)\s*\|\s*(?:ba)?sh\b/i, label: 'base64 -d | sh' },
  { pattern: /\bxxd\b\s+-r\s*\|\s*(?:ba)?sh\b/i, label: 'xxd -r | sh' },
  // fork bomb: allow optional whitespace before & (both ":|:&" and ":|: &" are valid bash)
  { pattern: /:\(\)\{\s*:\|:\s*&\s*\};:/, label: 'fork bomb' },
  { pattern: />\s*\/dev\/sd[a-z]/, label: '直写磁盘设备' },
  // chmod: allow optional flags (like -R) between chmod and 777
  { pattern: /chmod\s+(-[a-zA-Z]+\s+)*777\s+\//, label: 'chmod 777 根目录' },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the given code contains an obviously destructive command.
 * Returns the human-readable label of the first matched pattern, or `null`
 * if the code appears safe.
 */
export function hasDangerousCommand(code: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return label;
    }
  }
  return null;
}

/**
 * Validate code before sending it to the execution gateway.
 *
 * Checks:
 * 1. Code length ≤ 10 KB
 * 2. No obviously destructive commands
 */
export function validateCode(code: string, _language: string): ValidationResult {
  // 1. Length check
  if (code.length > MAX_CODE_LENGTH) {
    return { valid: false, reason: `代码长度 ${code.length} 字符超过 10KB 限制` };
  }

  // 2. Dangerous command check
  const danger = hasDangerousCommand(code);
  if (danger) {
    return { valid: false, reason: `检测到危险命令: ${danger}` };
  }

  return { valid: true };
}

/**
 * Truncate output that exceeds `maxBytes` (default 50 KB).
 *
 * Uses `Buffer` byte-level slicing so the truncation point is precise.
 * Node.js `Buffer.toString('utf8')` replaces incomplete trailing byte
 * sequences with U+FFFD; we strip those to guarantee clean UTF-8 output.
 */
export function truncateOutput(output: string, maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES): string {
  // Guard: treat negative or zero maxBytes as "truncate everything"
  const effectiveMax = Math.max(0, maxBytes);
  // Pre-slice strings to avoid OOM crashes on massive outputs > 100MB
  // A UTF-16 surrogate pair takes 2 JS length units max per 4 bytes, so effectiveMax * 2 is a safe upper bound
  // +100 as padding for safe measure
  const safeStr = output.length > effectiveMax * 2 + 100 
    ? output.substring(0, effectiveMax * 2 + 100) 
    : output;
    
  if (Buffer.byteLength(safeStr, 'utf8') <= effectiveMax) {
    // If output was naturally shorter than maxBytes, return original (or pre-sliced if it somehow was just emojis)
    if (output.length === safeStr.length) return output;
  }
  
  // Buffer.toString('utf8') replaces incomplete trailing byte sequences with
  // U+FFFD (replacement character). Strip those to guarantee clean output.
  const raw = Buffer.from(safeStr, 'utf8').subarray(0, effectiveMax).toString('utf8');
  const truncated = raw.replace(/\uFFFD+$/, '');
  return truncated + '\n\n[OUTPUT TRUNCATED — exceeded 50KB limit]';
}
