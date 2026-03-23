/**
 * OpenClaw Adapter Tests
 *
 * Unit tests run with `npm test` (no Gateway needed).
 *
 * Integration / connectivity tests should be run via the smoke test:
 *   npm run smoke
 *
 * Why? The OpenClaw CLI uses advanced terminal I/O that Vitest's forked
 * worker process cannot capture reliably. The smoke test runs `npx tsx`
 * directly and works perfectly.
 */

import { describe, it, expect } from 'vitest';
import { OpenClawAdapter } from '../../src/openclaw/adapter.js';

describe('OpenClawAdapter', () => {
  describe('Unit', () => {
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

    it('rejects unsupported language in executeCode', async () => {
      const a = new OpenClawAdapter();
      await expect(a.executeCode('code', 'brainfuck')).rejects.toThrow(
        'Unsupported language: brainfuck',
      );
    });

    it('healthCheck returns HealthStatus shape', async () => {
      const a = new OpenClawAdapter();
      const health = await a.healthCheck();
      // Don't assert on actual status — just verify the shape
      expect(health).toHaveProperty('cli');
      expect(health).toHaveProperty('gateway');
      expect(health).toHaveProperty('details');
      expect(typeof health.cli).toBe('boolean');
      expect(typeof health.gateway).toBe('boolean');
      expect(typeof health.details).toBe('string');
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
