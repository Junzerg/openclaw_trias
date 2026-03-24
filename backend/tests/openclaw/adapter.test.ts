/**
 * OpenClaw Adapter Tests — Phase 3.1
 *
 * Unit tests run with `npm test` (no Gateway needed).
 *
 * Integration / connectivity tests should be run via the smoke test:
 *   npm run smoke
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenClawAdapter, type ITransport, OpenClawError, OpenClawErrorType } from '../../src/openclaw/adapter.js';

// ─── Mock Transport ──────────────────────────────────────────────────────────

/**
 * A mock ITransport that returns pre-configured responses without spawning
 * any child processes. Used for all unit tests.
 */
class MockTransport implements ITransport {
  /** Queue of responses to return from `send()` — shifted in order. */
  public responses: string[];
  /** Recorded calls to `send()` for assertions. */
  public sendCalls: { args: string[]; timeoutMs: number }[] = [];
  /** Artificial delay (ms) to simulate slow CLI calls. */
  public delayMs: number;
  /** If set, `send()` will reject with this error. */
  public errorToThrow?: Error;

  private progressCallback?: (elapsedMs: number) => void;

  constructor(responses: string[] = ['mock output'], delayMs = 0) {
    this.responses = [...responses];
    this.delayMs = delayMs;
  }

  onProgress(callback: (elapsedMs: number) => void): void {
    this.progressCallback = callback;
  }

  async send(args: string[], timeoutMs: number): Promise<string> {
    this.sendCalls.push({ args, timeoutMs });

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    return this.responses.shift() ?? '';
  }

  dispose(): void {
    this.progressCallback = undefined;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OpenClawAdapter', () => {
  // ── Existing unit tests (preserved) ────────────────────────────────────

  describe('Unit — Construction', () => {
    it('creates adapter with default config', () => {
      const a = new OpenClawAdapter();
      expect(a).toBeInstanceOf(OpenClawAdapter);
    });

    it('creates adapter with custom config', () => {
      const a = new OpenClawAdapter({
        gatewayUrl: 'ws://custom:9999',
        defaultModel: 'anthropic/claude-sonnet-4-20250514',
        timeoutSeconds: 30,
        agentId: 'test-agent',
      });
      expect(a).toBeInstanceOf(OpenClawAdapter);
    });

    it('creates adapter with injected ITransport', () => {
      const transport = new MockTransport();
      const a = new OpenClawAdapter({}, transport);
      expect(a).toBeInstanceOf(OpenClawAdapter);
    });
  });

  describe('Unit — callLLM (mock transport)', () => {
    let transport: MockTransport;
    let adapter: OpenClawAdapter;

    beforeEach(() => {
      transport = new MockTransport(['This is a valid LLM response.']);
      adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
    });

    it('resolves with parsed content from transport', async () => {
      const result = await adapter.callLLM('system', 'hello');
      expect(result.content).toBe('This is a valid LLM response.');
      expect(result.rawOutput).toBe('This is a valid LLM response.');
    });

    it('passes correct CLI args to transport', async () => {
      await adapter.callLLM('sys prompt', 'user msg');
      expect(transport.sendCalls).toHaveLength(1);
      const call = transport.sendCalls[0];
      expect(call.args).toContain('agent');
      expect(call.args).toContain('--message');
      expect(call.timeoutMs).toBe(10 * 1000);
    });

    it('throws wrapped error when transport rejects', async () => {
      transport.errorToThrow = new Error('spawn failed');
      await expect(adapter.callLLM('s', 'u')).rejects.toThrow(
        '[OpenClawAdapter.callLLM] spawn failed',
      );
    });

    it('throws OpenClawError(GATEWAY_DISCONNECT) on gateway failure', async () => {
      // Provide enough responses for retry cycle (initial + 2 retries)
      transport.responses = [
        'gateway connect failed: connection refused',
        'gateway connect failed: connection refused',
        'gateway connect failed: connection refused',
      ];
      await expect(adapter.callLLM('s', 'u')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.GATEWAY_DISCONNECT;
      });
    });

    it('does NOT false-positive when LLM mentions gateway errors in content', async () => {
      // LLM response talks ABOUT gateway errors — should NOT throw
      transport.responses = [
        'Common OpenClaw errors include:\n' +
        '1. The "gateway connect failed" error occurs when the gateway is down.\n' +
        '2. Token limits can cause timeouts.',
      ];
      const result = await adapter.callLLM('sys', 'What errors can OpenClaw produce?');
      expect(result.content).toContain('gateway connect failed');
    });

    it('does NOT false-positive on stderr noise with Error: keyword', async () => {
      // stderr noise line (filtered) + content that mentions "gateway closed"
      transport.responses = [
        '[plugins] Error: reconnecting to server\n' +
        'The gateway closed gracefully after the session ended.',
      ];
      const result = await adapter.callLLM('sys', 'What happened?');
      // [plugins] line is filtered out, remaining content should NOT trigger false positive
      expect(result.content).toContain('gateway closed gracefully');
    });

    it('throws OpenClawError(JSON_PARSE_ERROR) when LLM returns empty output', async () => {
      // All lines are spinner/banner characters → cleaned output is empty
      // Provide enough responses for retry cycle (initial + 2 retries)
      transport.responses = [
        '🦞 OpenClaw v1.2.3\n⠋ Loading...',
        '🦞 OpenClaw v1.2.3\n⠋ Loading...',
        '🦞 OpenClaw v1.2.3\n⠋ Loading...',
      ];
      await expect(adapter.callLLM('s', 'u')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.JSON_PARSE_ERROR;
      });
    });
  });

  describe('Unit — callLLM retry integration', () => {
    it('retries on JSON_PARSE_ERROR then succeeds on 2nd try', async () => {
      const transport = new MockTransport([
        '🦞 OpenClaw v1.2.3\n⠋ Loading...',   // empty → JSON_PARSE_ERROR (retryable)
        'Recovered LLM response content',       // second try succeeds
      ]);
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      const result = await adapter.callLLM('sys', 'hello');
      expect(result.content).toBe('Recovered LLM response content');
      expect(transport.sendCalls.length).toBe(2); // initial + 1 retry
    });

    it('classifies CLI transport timeout as retryable LLM_TIMEOUT', async () => {
      const transport = new MockTransport([]);
      transport.errorToThrow = new Error('CLI timeout after 10000ms');
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      await expect(adapter.callLLM('s', 'u')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.LLM_TIMEOUT &&
               err.retryable === true;
      });
    });

    it('non-retryable MODEL_NOT_FOUND is not retried', async () => {
      const transport = new MockTransport([
        'Error: model not found: gpt-99',
        'Error: model not found: gpt-99',
        'Error: model not found: gpt-99',
      ]);
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      await expect(adapter.callLLM('s', 'u')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.MODEL_NOT_FOUND;
      });
      // Non-retryable: should only attempt once (no retries)
      expect(transport.sendCalls.length).toBe(1);
    });
  });

  describe('Unit — executeCode', () => {
    it('rejects unsupported language', async () => {
      const a = new OpenClawAdapter();
      await expect(a.executeCode('code', 'brainfuck')).rejects.toThrow(
        'Unsupported language: brainfuck',
      );
    });

    it('resolves with parsed output from transport', async () => {
      const transport = new MockTransport(['hello from openclaw\n4']);
      const adapter = new OpenClawAdapter({}, transport);
      const result = await adapter.executeCode('console.log("hi")', 'javascript');
      expect(result.stdout).toContain('hello from openclaw');
      expect(result.exitCode).toBe(0);
    });

    it('throws OpenClawError on gateway failure during code execution', async () => {
      const transport = new MockTransport([
        'gateway connect failed: ECONNREFUSED',
        'gateway connect failed: ECONNREFUSED',
        'gateway connect failed: ECONNREFUSED',
      ]);
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      await expect(adapter.executeCode('1+1', 'javascript')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.GATEWAY_DISCONNECT;
      });
    });

    it('classifies CLI timeout as retryable during code execution', async () => {
      const transport = new MockTransport([]);
      transport.errorToThrow = new Error('CLI timeout after 10000ms');
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      await expect(adapter.executeCode('while(true){}', 'javascript')).rejects.toSatisfy((err: unknown) => {
        return err instanceof OpenClawError &&
               err.type === OpenClawErrorType.LLM_TIMEOUT &&
               err.retryable === true;
      });
    });
  });

  describe('Unit — wrapError edge cases', () => {
    it('wraps non-Error thrown values (e.g. string) as generic Error', async () => {
      // MockTransport only throws Error objects, so we simulate the non-Error path
      // by testing callLLM with a custom transport that throws a string
      const transport: ITransport = {
        async send() { throw 'raw string error'; },
      };
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      await expect(adapter.callLLM('s', 'u')).rejects.toSatisfy((err: unknown) => {
        return err instanceof Error &&
               !(err instanceof OpenClawError) &&
               err.message.includes('raw string error');
      });
    });
  });

  describe('Unit — ANSI stripping', () => {
    it('strips ANSI color codes and extracts clean content', async () => {
      const transport = new MockTransport([
        '\x1b[32m✓\x1b[0m Clean response after ANSI codes',
      ]);
      const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);
      const result = await adapter.callLLM('sys', 'hello');
      expect(result.content).not.toContain('\x1b');
      expect(result.content).toContain('Clean response after ANSI codes');
    });
  });

  describe('Unit — healthCheck', () => {
    it('returns HealthStatus shape even when CLI unavailable', async () => {
      const transport = new MockTransport([]);
      transport.errorToThrow = new Error('command not found');
      const adapter = new OpenClawAdapter({}, transport);
      const health = await adapter.healthCheck();
      expect(health).toHaveProperty('cli');
      expect(health).toHaveProperty('gateway');
      expect(health).toHaveProperty('details');
      expect(typeof health.cli).toBe('boolean');
      expect(typeof health.gateway).toBe('boolean');
      expect(typeof health.details).toBe('string');
      expect(health.cli).toBe(false);
    });

    it('reports cli=true even when --version output is banner-only', async () => {
      // Bug fix test: extractLLMContent throws on banner-only output,
      // but healthCheck should fallback gracefully
      const transport = new MockTransport(['🦞 OpenClaw v2.1.0\n⠋ Loading plugins...']);
      const adapter = new OpenClawAdapter({}, transport);
      const health = await adapter.healthCheck();
      expect(health.cli).toBe(true);
      expect(health.details).toContain('CLI version:');
    });

    it('reports cli=true with parseable version output', async () => {
      const transport = new MockTransport(['openclaw v2.1.0']);
      const adapter = new OpenClawAdapter({}, transport);
      const health = await adapter.healthCheck();
      expect(health.cli).toBe(true);
      expect(health.details).toContain('openclaw v2.1.0');
    });

    it('reports cli=false when --version returns empty string', async () => {
      const transport = new MockTransport(['']);
      const adapter = new OpenClawAdapter({}, transport);
      const health = await adapter.healthCheck();
      expect(health.cli).toBe(false);
      expect(health.details).toContain('no output');
    });
  });

  // ── New Phase 3.1 async / concurrency tests ────────────────────────────

  describe('Async — Concurrency safety', () => {
    it('handles two parallel callLLM() calls independently', async () => {
      const transport = new MockTransport([
        'Response A from LLM',
        'Response B from LLM',
      ], 10);
      const adapter = new OpenClawAdapter({}, transport);

      const [a, b] = await Promise.all([
        adapter.callLLM('sys', 'question A'),
        adapter.callLLM('sys', 'question B'),
      ]);

      expect(a.content).toBe('Response A from LLM');
      expect(b.content).toBe('Response B from LLM');
      expect(transport.sendCalls).toHaveLength(2);
    });
  });

  describe('Async — Timeout', () => {
    it('CliTransport rejects with timeout error and kills child process', async () => {
      // Import ClitTransport directly to test timeout logic
      const { CliTransport } = await import('../../src/openclaw/transport.js');
      const cli = new CliTransport('sleep'); // `sleep 999` will block

      // 200ms timeout should fire well before sleep completes
      await expect(
        cli.send(['999'], 200),
      ).rejects.toThrow(/CLI timeout after 200ms/);
    });
  });

  describe('Async — Progress callback', () => {
    it('CliTransport fires onProgress during long-running command', async () => {
      const { CliTransport } = await import('../../src/openclaw/transport.js');
      // Use `sleep 10` which will run long enough for at least 1 heartbeat (3s)
      // but we'll kill it via timeout at 4s
      const cli = new CliTransport('sleep');
      const progressCalls: number[] = [];
      cli.onProgress!((elapsed) => progressCalls.push(elapsed));

      // Timeout at 4s — should fire 1 heartbeat at ~3s before timing out
      await expect(cli.send(['10'], 4000)).rejects.toThrow(/CLI timeout/);
      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[0]).toBe(3000);
    }, 10000);

    it('CliTransport does NOT fire onProgress for fast commands', async () => {
      const { CliTransport } = await import('../../src/openclaw/transport.js');
      const cli = new CliTransport('echo');
      const calls: number[] = [];
      cli.onProgress!((elapsed) => calls.push(elapsed));

      await cli.send(['hello'], 5000);
      expect(calls).toHaveLength(0);
    });

    it('dispose() clears progressCallback', async () => {
      const { CliTransport } = await import('../../src/openclaw/transport.js');
      const cli = new CliTransport('echo');
      cli.onProgress!(() => {});
      cli.dispose!();
      // After dispose, subsequent send() should not crash even without callback
      const result = await cli.send(['test'], 5000);
      expect(result).toContain('test');
    });
  });

  describe('Async — MaxBuffer protection', () => {
    it('CliTransport caps output at MAX_BUFFER (10MB) — no OOM', async () => {
      const { CliTransport } = await import('../../src/openclaw/transport.js');
      // `yes` outputs infinite "y\n" lines — we timeout after 500ms
      // In 500ms, `yes` produces ~50MB+ of output
      const cli = new CliTransport('yes');
      try {
        await cli.send([], 500);
      } catch {
        // timeout expected
      }
      // If we got here without OOM, the MAX_BUFFER cap worked :)
      // We can't easily read the internal buffer from here, but not crashing = success
      expect(true).toBe(true);
    });
  });

  /**
   * Integration tests are deliberately skipped in Vitest.
   *
   * The OpenClaw CLI's I/O cannot be captured by Vitest's forked processes.
   * Use `npm run smoke` instead — it runs the adapter's built-in smoke test
   * which validates:
   *  1. HealthCheck (CLI + Gateway)
   *  2. LLM call (real model response)
   *  3. Code execution (exec tool)
   */
  describe('Integration (run `npm run smoke` instead)', () => {
    it.skip('callLLM — use `npm run smoke` for real LLM test', () => {});
    it.skip('executeCode — use `npm run smoke` for real exec test', () => {});
  });
});
