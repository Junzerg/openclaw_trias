/**
 * Security Sandbox Tests — Task 3.6
 *
 * Covers:
 * - hasDangerousCommand: all 6 destructive patterns + safe code passthrough
 * - validateCode: length limit, dangerous command rejection, normal passthrough
 * - truncateOutput: byte-precise truncation, UTF-8 boundary safety, edge cases
 */

import { describe, it, expect } from 'vitest';
import { hasDangerousCommand, validateCode, truncateOutput } from '../../src/openclaw/sandbox';

// ── hasDangerousCommand ──────────────────────────────────────────────────────

describe('hasDangerousCommand', () => {
  it('should detect rm -rf /', () => {
    expect(hasDangerousCommand('rm -rf /')).toContain('rm -rf');
  });

  it('should detect rm -f /etc/passwd', () => {
    expect(hasDangerousCommand('rm -f /etc/passwd')).toContain('rm -rf');
  });

  it('should detect rm with multiple flags including f', () => {
    expect(hasDangerousCommand('rm -r -f -v /home')).toContain('rm -rf');
  });

  it('should detect rm /some/path (without -f flag)', () => {
    expect(hasDangerousCommand('rm /some/path')).toContain('rm -rf');
  });

  it('should detect mkfs', () => {
    expect(hasDangerousCommand('mkfs /dev/sda')).toBe('mkfs (格式化磁盘)');
  });

  it('should detect mkfs.ext4', () => {
    expect(hasDangerousCommand('mkfs.ext4 /dev/sda1')).toBe('mkfs (格式化磁盘)');
  });

  it('should detect dd if=', () => {
    expect(hasDangerousCommand('dd if=/dev/zero of=/dev/sda')).toBe('dd (磁盘写入)');
  });

  it('should detect fork bomb', () => {
    expect(hasDangerousCommand(':(){ :|:& };:')).toBe('fork bomb');
  });

  it('should detect writing to disk device', () => {
    expect(hasDangerousCommand('echo "data" > /dev/sda')).toBe('直写磁盘设备');
  });

  it('should detect chmod 777 /', () => {
    expect(hasDangerousCommand('chmod 777 /')).toBe('chmod 777 根目录');
  });

  it('should detect chmod 777 /etc', () => {
    expect(hasDangerousCommand('chmod 777 /etc')).toBe('chmod 777 根目录');
  });

  // ── Safe code should NOT be flagged ──

  it('should NOT flag normal Python code', () => {
    expect(hasDangerousCommand('print("hello world")')).toBeNull();
  });

  it('should NOT flag rm without a root-ish path', () => {
    expect(hasDangerousCommand('rm temp.txt')).toBeNull();
  });

  it('should NOT flag dd without if=', () => {
    expect(hasDangerousCommand('dd --help')).toBeNull();
  });

  it('should NOT flag chmod with non-777 permissions', () => {
    expect(hasDangerousCommand('chmod 755 /usr/local/bin/app')).toBeNull();
  });

  it('should NOT flag a string mentioning rm in a print statement', () => {
    expect(hasDangerousCommand("print('use rm to delete files')")).toBeNull();
  });

  it('should NOT flag empty string', () => {
    expect(hasDangerousCommand('')).toBeNull();
  });

  it('should detect dangerous command on a non-first line (multiline code)', () => {
    const code = `
      echo "hello"
      rm -rf /
      ls -la
    `;
    expect(hasDangerousCommand(code)).toContain('rm -rf');
  });

  it('should detect dd if= embedded in a longer script', () => {
    const script = '#!/bin/bash\nbackup() {\n  dd if=/dev/sda of=/backup.img\n}';
    expect(hasDangerousCommand(script)).toBe('dd (磁盘写入)');
  });

  // ── Bug fix regression tests (Round 2) ──

  it('should detect rm -r / (recursive without -f flag)', () => {
    expect(hasDangerousCommand('rm -r /')).toContain('rm -rf');
  });

  it('should detect rm -ri /etc (recursive interactive)', () => {
    expect(hasDangerousCommand('rm -ri /etc')).toContain('rm -rf');
  });

  it('should detect rm --recursive / (long flag form)', () => {
    expect(hasDangerousCommand('rm --recursive /')).toContain('rm -rf');
  });

  it('should detect rm --force --recursive / (multiple long flags)', () => {
    expect(hasDangerousCommand('rm --force --recursive /')).toContain('rm -rf');
  });

  it('should detect fork bomb with space before & — :(){ :|: & };:', () => {
    expect(hasDangerousCommand(':(){ :|: & };:')).toBe('fork bomb');
  });

  it('should detect chmod -R 777 / (recursive form)', () => {
    expect(hasDangerousCommand('chmod -R 777 /')).toBe('chmod 777 根目录');
  });
});

// ── validateCode ─────────────────────────────────────────────────────────────

describe('validateCode', () => {
  it('should pass normal short code', () => {
    const result = validateCode('print("hello")', 'python');
    expect(result).toEqual({ valid: true });
  });

  it('should pass empty string', () => {
    const result = validateCode('', 'python');
    expect(result).toEqual({ valid: true });
  });

  it('should pass code at exactly 10KB', () => {
    const code = 'a'.repeat(10 * 1024);
    const result = validateCode(code, 'python');
    expect(result).toEqual({ valid: true });
  });

  it('should reject code over 10KB', () => {
    const code = 'a'.repeat(10 * 1024 + 1);
    const result = validateCode(code, 'python');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('10KB');
    expect(result.reason).toContain(String(code.length));
  });

  it('should reject code with dangerous command in multiline context', () => {
    const code = '# Step 1: clean up\nrm -rf /tmp/old\n# Step 2: full wipe\nrm -rf /';
    const result = validateCode(code, 'bash');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('危险命令');
  });

  it('should reject code containing dangerous commands', () => {
    const result = validateCode('rm -rf /', 'bash');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('危险命令');
    expect(result.reason).toContain('rm -rf');
  });

  it('should reject mkfs command', () => {
    const result = validateCode('mkfs /dev/sda', 'bash');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mkfs');
  });

  it('should pass safe bash code', () => {
    const result = validateCode('echo "hello world" && ls -la', 'bash');
    expect(result).toEqual({ valid: true });
  });

  it('should check length before dangerous commands (length takes priority)', () => {
    // Build a code string that is > 10KB AND contains a dangerous command
    const longDangerousCode = 'a'.repeat(10 * 1024 + 1) + 'rm -rf /';
    const result = validateCode(longDangerousCode, 'bash');
    expect(result.valid).toBe(false);
    // Length check runs first, so reason should mention length
    expect(result.reason).toContain('10KB');
  });
});

// ── truncateOutput ───────────────────────────────────────────────────────────

describe('truncateOutput', () => {
  it('should return output unchanged when under limit', () => {
    const output = 'hello world';
    expect(truncateOutput(output)).toBe(output);
  });

  it('should return empty string unchanged', () => {
    expect(truncateOutput('')).toBe('');
  });

  it('should return output unchanged when exactly at 50KB', () => {
    const output = 'a'.repeat(50 * 1024);
    expect(truncateOutput(output)).toBe(output);
  });

  it('should truncate output over 50KB and add marker', () => {
    const output = 'a'.repeat(50 * 1024 + 100);
    const result = truncateOutput(output);
    expect(result).toContain('[OUTPUT TRUNCATED');
    // The truncated part should be <= 50KB bytes + marker
    expect(result.length).toBeLessThan(output.length);
  });

  it('should respect custom maxBytes parameter', () => {
    const output = 'a'.repeat(200);
    const result = truncateOutput(output, 100);
    expect(result).toContain('[OUTPUT TRUNCATED');
    // First 100 bytes + marker
    expect(result.startsWith('a'.repeat(100))).toBe(true);
  });

  it('should not truncate when custom maxBytes is sufficient', () => {
    const output = 'hello';
    expect(truncateOutput(output, 100)).toBe('hello');
  });

  // ── UTF-8 multi-byte boundary safety ──

  it('should produce valid UTF-8 when truncating Chinese text', () => {
    // Each Chinese character is 3 bytes in UTF-8
    const chinese = '中文测试数据安全沙箱执行约束验证';

    // Truncate at 10 bytes — mid-character for the 4th Chinese char
    const result = truncateOutput(chinese, 10);

    expect(result).toContain('[OUTPUT TRUNCATED');
    // The truncated portion should be valid UTF-8 (3 complete characters = 9 bytes)
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    expect(truncatedText).toBe('中文测');
    // Verify it's valid UTF-8 by round-tripping through Buffer
    expect(Buffer.from(truncatedText, 'utf8').toString('utf8')).toBe(truncatedText);
  });

  it('should produce valid UTF-8 when truncating emoji text', () => {
    // Emoji are 4-byte UTF-8 characters
    const emoji = '😀😁😂🤣😃😄';
    // 6 emoji × 4 bytes = 24 bytes
    expect(Buffer.byteLength(emoji, 'utf8')).toBe(24);

    // Truncate at 5 bytes — mid-character for the 2nd emoji
    const result = truncateOutput(emoji, 5);
    expect(result).toContain('[OUTPUT TRUNCATED');
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    // Only 1 complete emoji (4 bytes), the 5th byte is incomplete → dropped
    expect(truncatedText).toBe('😀');
    expect(Buffer.from(truncatedText, 'utf8').toString('utf8')).toBe(truncatedText);
  });

  it('should handle mixed ASCII and multi-byte content', () => {
    const mixed = 'hello中文world';
    // 'hello' = 5 bytes, '中文' = 6 bytes, 'world' = 5 bytes = 16 total
    expect(Buffer.byteLength(mixed, 'utf8')).toBe(16);

    // Truncate at 7 bytes: 'hello' (5) + partial '中' (2 of 3)
    const result = truncateOutput(mixed, 7);
    expect(result).toContain('[OUTPUT TRUNCATED');
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    // Only 'hello' survives (5 bytes complete), '中' is incomplete → dropped
    expect(truncatedText).toBe('hello');
  });

  it('should handle maxBytes = 0', () => {
    const result = truncateOutput('hello', 0);
    expect(result).toContain('[OUTPUT TRUNCATED');
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    expect(truncatedText).toBe('');
  });

  it('should handle negative maxBytes without crashing', () => {
    const result = truncateOutput('hello world', -1);
    expect(result).toContain('[OUTPUT TRUNCATED');
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    expect(truncatedText).toBe(''); // negative → clamped to 0 → empty
  });

  it('should preserve natural U+FFFD in the middle during truncation', () => {
    const input = 'aaa\uFFFDbbb' + 'c'.repeat(100);
    const result = truncateOutput(input, 10);
    const truncatedText = result.split('\n\n[OUTPUT TRUNCATED')[0];
    // U+FFFD in middle position should be preserved (only trailing ones stripped)
    expect(truncatedText).toContain('\uFFFD');
  });
});
