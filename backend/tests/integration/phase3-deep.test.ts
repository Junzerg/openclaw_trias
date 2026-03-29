/**
 * Phase 3 Deep Integration Tests — MockTransport-level
 *
 * These tests do NOT mock at executionEngine.executeAct() level.
 * Instead, they only mock at the ITransport.send() level, forcing data
 * through the real code paths:
 *
 *   SecEngineering.executeTask()
 *     → _generateCode() → adapter.callLLM() → transport.send()
 *     → validateCode()   (sandbox pre-check)
 *     → adapter.executeCode() → transport.send()
 *     → truncateOutput() (output truncation)
 *
 *   SecState.executeTask()
 *     → _buildTaskPrompt() → adapter.callLLM() → transport.send()
 *
 * Only ITransport.send() is replaced by MockTransport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawAdapter, type ITransport } from '../../src/openclaw/adapter';
import { SecretaryOfEngineering } from '../../src/agents/executive/sec-engineering';
import { SecretaryOfState } from '../../src/agents/executive/sec-state';
import { ExecutionEngine, type TaskExecutor } from '../../src/agents/executive/engine';
// validateCode and truncateOutput are exercised implicitly through the real
// SecretaryOfEngineering code path — not called directly in tests.
import { MessageBus } from '../../src/bus/message-bus';
import type { Act, ExecutionTask } from '../../src/schemas/act';
import { randomUUID } from 'node:crypto';

// ── MockTransport ────────────────────────────────────────────────────────────

/**
 * A minimal ITransport that returns pre-configured responses in order.
 * Each call to send() pops the next response from the queue.
 */
class MockTransport implements ITransport {
  private _responses: string[];
  private _callIndex = 0;
  public calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];

  constructor(responses: string[]) {
    this._responses = responses;
  }

  async send(args: string[], _timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string> {
    this.calls.push({ args, env });
    if (this._callIndex >= this._responses.length) {
      throw new Error(
        `MockTransport: no more responses (called ${this._callIndex + 1} times, but only ${this._responses.length} responses configured)`
      );
    }
    return this._responses[this._callIndex++];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    task_id: randomUUID(),
    act_id: randomUUID(),
    step: {
      index: 0,
      description: '用 Python 编写 hello world',
      required_skill: 'CodeExecution',
      tool_parameters: {},
      estimated_tokens: 50,
      acceptance_criteria: 'stdout 包含 hello',
      dependencies: [],
    },
    assigned_to: 'sec_engineering',
    ...overrides,
  };
}

function makeAct(overrides: Partial<Act> = {}): Act {
  return {
    act_id: randomUUID(),
    title: 'Test Act',
    summary: 'Test summary',
    petition_origin: '写一个 hello world',
    steps: [
      {
        index: 0,
        description: '用 Python 编写 hello world',
        required_skill: 'CodeExecution',
        tool_parameters: {},
        estimated_tokens: 50,
        acceptance_criteria: 'stdout 包含 hello',
        dependencies: [],
      },
    ],
    total_estimated_tokens: 50,
    debate_record: {
      total_rounds: 1,
      final_conflict_score: 10,
      consensus_points: ['同意'],
      remaining_concerns: [],
    },
    vote_record: {
      ayes: 2,
      nays: 0,
      result: 'passed',
      voter_positions: {},
    },
    created_at: new Date(),
    ...overrides,
  } as Act;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 3 Deep Integration — MockTransport Level', () => {
  let bus: MessageBus;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bus = new MessageBus();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 1: Happy Path — SecEngineering full chain
  //
  // MockTransport response #1: LLM code generation → JSON with { language, code }
  // MockTransport response #2: Code execution → stdout result
  //
  // This verifies: _generateCode() → validateCode() → adapter.executeCode() → truncateOutput()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SecEngineering Happy Path (full chain)', () => {
    it('should flow through _generateCode → validateCode → executeCode → truncateOutput', async () => {
      const mockTransport = new MockTransport([
        // Response 1: LLM code generation (callLLM)
        '{"language":"python","code":"print(\'hello world\')"}',
        // Response 2: Code execution (executeCode) - the CLI returns stdout
        'hello world',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      // Verify success
      expect(result.status).toBe('success');
      expect(result.output).toContain('hello world');
      expect(result.error).toBeUndefined();

      // Verify MockTransport was called exactly twice
      // Call 1: callLLM for code generation
      // Call 2: executeCode
      expect(mockTransport.calls.length).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 2: Sandbox Block — validateCode() rejects dangerous code
  //
  // MockTransport response #1: LLM generates code containing "rm -rf /"
  // No response #2 needed: validateCode() should block before executeCode()
  //
  // This verifies: _generateCode() → validateCode() REJECTS → TaskResult.status='failed'
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Sandbox Block (dangerous code rejection)', () => {
    it('should reject code with rm -rf / via validateCode before execution', async () => {
      const mockTransport = new MockTransport([
        // Response 1: LLM generates dangerous code
        '{"language":"bash","code":"rm -rf /"}',
        // No response 2: validateCode should block before executeCode is called
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask({
        step: {
          index: 0,
          description: '清理系统文件',
          required_skill: 'CodeExecution',
          tool_parameters: {},
          estimated_tokens: 50,
          acceptance_criteria: '文件已清理',
          dependencies: [],
        },
      });

      const result = await sec.executeTask(task);

      // validateCode should have blocked this
      expect(result.status).toBe('failed');
      expect(result.error).toContain('安全检查未通过');
      expect(result.error).toContain('rm -rf');
      expect(result.output).toBe('');

      // Only 1 transport call (code generation), NOT 2 (no executeCode call)
      expect(mockTransport.calls.length).toBe(1);
    });

    it('should reject fork bomb code via validateCode', async () => {
      const mockTransport = new MockTransport([
        '{"language":"bash","code":":(){ :|:& };:"}',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('安全检查未通过');
      expect(result.error).toContain('fork bomb');
      expect(mockTransport.calls.length).toBe(1);
    });

    it('should reject oversized code (>10KB) via validateCode', async () => {
      const oversizedCode = 'a'.repeat(10 * 1024 + 1);
      const mockTransport = new MockTransport([
        JSON.stringify({ language: 'python', code: oversizedCode }),
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('安全检查未通过');
      expect(result.error).toContain('10KB');
      expect(mockTransport.calls.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 3: Output Truncation — truncateOutput() applied to stdout > 50KB
  //
  // MockTransport response #1: LLM generates safe code
  // MockTransport response #2: Code execution returns >50KB stdout
  //
  // This verifies: executeCode returns large output → truncateOutput() truncates → [OUTPUT TRUNCATED] marker
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Output Truncation (>50KB stdout)', () => {
    it('should truncate output exceeding 50KB and include truncation marker', async () => {
      const largeOutput = 'x'.repeat(60 * 1024); // 60KB of 'x'

      const mockTransport = new MockTransport([
        // Response 1: LLM code generation
        JSON.stringify({ language: 'python', code: "print('x' * 61440)" }),
        // Response 2: Code execution returns large stdout
        largeOutput,
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      expect(result.status).toBe('success');
      // Output should contain the truncation marker
      expect(result.output).toContain('[OUTPUT TRUNCATED');
      // Output should be significantly shorter than the original 60KB
      expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThan(60 * 1024);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 4: SecState — search task flows through real code
  //
  // MockTransport response #1: LLM returns search results
  //
  // This verifies: SecState.executeTask() → _buildTaskPrompt() → callLLM() → transport.send()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SecState full chain', () => {
    it('should flow through _buildTaskPrompt → callLLM for Search skill', async () => {
      const searchResult = '搜索结果摘要：TypeScript 是一种由微软开发的编程语言。';

      const mockTransport = new MockTransport([
        // Response 1: LLM returns search results
        searchResult,
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const secState = new SecretaryOfState(adapter, bus);
      const task: ExecutionTask = {
        task_id: randomUUID(),
        act_id: randomUUID(),
        step: {
          index: 0,
          description: '搜索 TypeScript 的基本信息',
          required_skill: 'Search',
          tool_parameters: {},
          estimated_tokens: 30,
          acceptance_criteria: '返回搜索结果',
          dependencies: [],
        },
        assigned_to: 'sec_state',
      };

      const result = await secState.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.output).toContain('TypeScript');
      expect(mockTransport.calls.length).toBe(1);

      // Verify the transport received the search-specific prompt
      const sentArgs = mockTransport.calls[0].args;
      expect(sentArgs).toContain('--message');
      const messageArg = sentArgs[sentArgs.indexOf('--message') + 1];
      expect(messageArg).toContain('搜索工具');
    });

    it('should handle WebBrowser skill via _buildTaskPrompt', async () => {
      const pageContent = '页面内容：TypeScript 官网首页';

      const mockTransport = new MockTransport([pageContent]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const secState = new SecretaryOfState(adapter, bus);
      const task: ExecutionTask = {
        task_id: randomUUID(),
        act_id: randomUUID(),
        step: {
          index: 0,
          description: '访问 TypeScript 官网',
          required_skill: 'WebBrowser',
          tool_parameters: {},
          estimated_tokens: 30,
          acceptance_criteria: '返回页面内容',
          dependencies: [],
        },
        assigned_to: 'sec_state',
      };

      const result = await secState.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.output).toContain('TypeScript');
      expect(mockTransport.calls.length).toBe(1);

      // Verify the transport received the browser-specific prompt
      const sentArgs = mockTransport.calls[0].args;
      const messageArg = sentArgs[sentArgs.indexOf('--message') + 1];
      expect(messageArg).toContain('浏览器工具');
    });

    it('should return failed when LLM returns empty response', async () => {
      const mockTransport = new MockTransport([
        // LLM returns only whitespace
        '   ',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const secState = new SecretaryOfState(adapter, bus);
      const task: ExecutionTask = {
        task_id: randomUUID(),
        act_id: randomUUID(),
        step: {
          index: 0,
          description: '搜索不存在的内容',
          required_skill: 'Search',
          tool_parameters: {},
          estimated_tokens: 30,
          acceptance_criteria: '返回结果',
          dependencies: [],
        },
        assigned_to: 'sec_state',
      };

      const result = await secState.executeTask(task);

      // Empty response should be treated as failure
      expect(result.status).toBe('failed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 5: ExecutionEngine → SecEngineering full chain
  //
  // Verifies that ExecutionEngine.executeAct() dispatches to SecEngineering,
  // which then runs through the full _generateCode → validateCode → executeCode path.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ExecutionEngine → SecEngineering integration', () => {
    it('should dispatch through ExecutionEngine and produce real TaskResult', async () => {
      const mockTransport = new MockTransport([
        // Response 1: LLM code generation
        '{"language":"python","code":"print(\'hello from engine\')"}',
        // Response 2: Code execution
        'hello from engine',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const secEng = new SecretaryOfEngineering(adapter, bus);

      const cabinet: Record<string, TaskExecutor> = {
        CodeExecution: secEng,
        Python_Interpreter: secEng,
      };
      const engine = new ExecutionEngine(cabinet);
      const act = makeAct();

      const report = await engine.executeAct(act);

      expect(report.overall_status).toBe('completed');
      expect(report.task_results.length).toBe(1);
      expect(report.task_results[0].status).toBe('success');
      expect(report.task_results[0].output).toContain('hello from engine');
    });

    it('should produce failed report when sandbox blocks dangerous code', async () => {
      const mockTransport = new MockTransport([
        // Response 1: LLM generates dangerous code
        '{"language":"bash","code":"rm -rf /"}',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const secEng = new SecretaryOfEngineering(adapter, bus);

      const cabinet: Record<string, TaskExecutor> = {
        CodeExecution: secEng,
      };
      const engine = new ExecutionEngine(cabinet);
      const act = makeAct({
        steps: [
          {
            index: 0,
            description: '危险操作',
            required_skill: 'CodeExecution',
            tool_parameters: {},
            estimated_tokens: 50,
            acceptance_criteria: '完成',
            dependencies: [],
          },
        ],
      });

      const report = await engine.executeAct(act);

      expect(report.overall_status).toBe('failed');
      expect(report.task_results[0].status).toBe('failed');
      expect(report.task_results[0].error).toContain('安全检查未通过');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 6: Mixed multi-step — SecEngineering + SecState via ExecutionEngine
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ExecutionEngine multi-step mixed (SecEng + SecState)', () => {
    it('should dispatch steps to correct secretaries and aggregate results', async () => {
      // SecEng needs 2 transport calls (code gen + code exec)
      // SecState needs 1 transport call (callLLM)
      // Since steps run in parallel (same topological level, no deps),
      // we need to use separate transports for each secretary.
      const engTransport = new MockTransport([
        '{"language":"python","code":"print(42)"}',
        '42',
      ]);
      const stateTransport = new MockTransport([
        '搜索结果：42是宇宙的答案',
      ]);

      const engAdapter = new OpenClawAdapter({}, engTransport);
      const stateAdapter = new OpenClawAdapter({}, stateTransport);

      const secEng = new SecretaryOfEngineering(engAdapter, bus);
      const secState = new SecretaryOfState(stateAdapter, bus);

      const cabinet: Record<string, TaskExecutor> = {
        CodeExecution: secEng,
        Search: secState,
      };
      const engine = new ExecutionEngine(cabinet);

      const act = makeAct({
        steps: [
          {
            index: 0,
            description: '计算 42',
            required_skill: 'CodeExecution',
            tool_parameters: {},
            estimated_tokens: 30,
            acceptance_criteria: '输出42',
            dependencies: [],
          },
          {
            index: 1,
            description: '搜索42的含义',
            required_skill: 'Search',
            tool_parameters: {},
            estimated_tokens: 20,
            acceptance_criteria: '返回搜索结果',
            dependencies: [],
          },
        ],
        total_estimated_tokens: 50,
      });

      const report = await engine.executeAct(act);

      expect(report.overall_status).toBe('completed');
      expect(report.task_results.length).toBe(2);

      // Step 0: SecEngineering
      const engResult = report.task_results.find(r => r.step_index === 0);
      expect(engResult?.status).toBe('success');
      expect(engResult?.output).toContain('42');

      // Step 1: SecState
      const stateResult = report.task_results.find(r => r.step_index === 1);
      expect(stateResult?.status).toBe('success');
      expect(stateResult?.output).toContain('42');
    });
  });
});
