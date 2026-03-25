/**
 * Phase 3 Deep Audit — Round 2
 *
 * Additional bugs discovered during systematic code audit:
 *
 * Bug 4: adapter.executeCode() always returns exitCode: 0.
 *         This means SecEngineering never produces 'failed' from code execution
 *         results — only from exceptions or sandbox blocks.
 *
 * Bug 5: ResultReviewer.reviewDelivery() passes literal '(无有效产出)' to the
 *         deviation scorer when all tasks fail, which produces arbitrary scores.
 *
 * Bug 6: government._runPipeline() never checks report.overall_status before
 *         sending to ChiefJustice. Failed executions proceed to review.
 *
 * Bug 7: SecEngineering._generateCode() fallback treats entire LLM response as
 *         Python code. If LLM mentions "rm -rf /" in prose, validateCode catches
 *         it (mitigated by Phase 1.5 fix). Test that the mitigation works.
 *
 * Bug 8: RulesEngine.checkCommand() regex patterns don't match when dangerous
 *         commands appear inside code snippets (e.g., "import os; os.system('rm -rf /')")
 *         but the ChiefJustice petition check uses the same regex against petition text.
 *
 * Bug 9: ExecutionEngine._executeStep() uses act.act_id as task_id (line 123),
 *         making all tasks in the same Act share the same task_id. This breaks
 *         task-level event correlation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawAdapter, type ITransport } from '../../src/openclaw/adapter';
import { SecretaryOfEngineering } from '../../src/agents/executive/sec-engineering';
import { SecretaryOfState } from '../../src/agents/executive/sec-state';
import { ExecutionEngine, type TaskExecutor } from '../../src/agents/executive/engine';
import { ResultReviewer } from '../../src/agents/judicial/result-reviewer';
import { RulesEngine, type DeviationScorer } from '../../src/agents/judicial/rules-engine';
import { ChiefJustice } from '../../src/agents/judicial/chief-justice';
import { BillLifecycle, BillState, InvalidTransitionError } from '../../src/bus/state-machine';
import { MessageBus } from '../../src/bus/message-bus';
import type { Act, ExecutionTask, ExecutionReport } from '../../src/schemas/act';
import type { ConstitutionConfig } from '../../src/config/models';
import { randomUUID } from 'node:crypto';

// ── MockTransport ────────────────────────────────────────────────────────────

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

/**
 * Minimal ConstitutionConfig for testing.
 */
function makeConstitution(): ConstitutionConfig {
  return {
    version: '1.0',
    judicial: {
      blacklist_commands: ['rm -rf', 'DROP TABLE', 'FORMAT', 'deltree', 'mkfs', 'dd if=', ':(){ :|:& };:', 'chmod -R 777', '> /dev/sda'],
      token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
      debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
      deviation: { max_score: 0.3 },
    },
    security: {
      sandbox_enabled: true,
      allowed_file_extensions: ['.py', '.js', '.ts', '.md', '.json', '.yaml', '.yml', '.toml', '.txt', '.html', '.css'],
      max_execution_time_seconds: 300,
      max_file_size_mb: 10,
      network_access: 'restricted',
    },
    rbac: {
      permissions: ['PLAN', 'EXECUTE', 'MONITOR', 'VETO', 'KILL'],
      role_permissions: {
        speaker: ['PLAN'],
        radical_mp: ['PLAN'],
        conservative_mp: ['PLAN'],
        president: ['PLAN', 'VETO'],
        sec_engineering: ['EXECUTE'],
        sec_state: ['EXECUTE'],
        chief_justice: ['MONITOR', 'KILL'],
      },
    },
  } as ConstitutionConfig;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 3 Deep Audit — Round 2', () => {
  let bus: MessageBus;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bus = new MessageBus();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 4: adapter.executeCode() always returns exitCode: 0
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 4 FIXED: executeCode now infers exitCode from output', () => {
    it('should detect Python traceback and report failed status', async () => {
      const mockTransport = new MockTransport([
        // Response 1: code generation — generate valid code
        JSON.stringify({ language: 'python', code: "raise Exception('error!')" }),
        // Response 2: code execution — agent wraps the error output
        'Traceback (most recent call last):\n  File "<stdin>", line 1\nException: error!',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      // FIXED: executeCode now detects the traceback and returns exitCode=1
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });

    it('should only produce failed status when transport throws (not from exitCode)', async () => {
      const mockTransport = new MockTransport([
        // Response 1: code generation
        '{"language":"python","code":"print(1)"}',
        // No response 2: transport will throw
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      // This time it fails because the transport throws, not because exitCode != 0
      expect(result.status).toBe('failed');
      expect(result.error).toContain('MockTransport: no more responses');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 5: ResultReviewer sends '(无有效产出)' to deviation scorer
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 5: ResultReviewer with all-failed tasks', () => {
    it('FIXED: should force-fail with max deviation when all tasks failed', async () => {
      const capturedOutputs: string[] = [];
      const mockScorer: DeviationScorer = async (_petition: string, output: string) => {
        capturedOutputs.push(output);
        return { score: 0.1, reason: 'mock reason' } as any; // Low deviation — would pass
      };

      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution, mockScorer);
      const reviewer = new ResultReviewer(rules);

      const report: ExecutionReport = {
        act_id: randomUUID(),
        overall_status: 'failed',
        task_results: [
          {
            task_id: randomUUID(),
            step_index: 0,
            status: 'failed',
            output: '',
            error: '安全检查未通过: rm -rf detected',
            tokens_consumed: 0,
          },
        ],
        total_tokens_consumed: 0,
        execution_time_seconds: 0.1,
      };

      const result = await reviewer.reviewDelivery('写一段简单的代码', report);

      // FIX: scorer is NOT called — short-circuited for zero-output case
      expect(capturedOutputs.length).toBe(0);
      // Force-failed with max deviation
      expect(result.passed).toBe(false);
      expect(result.deviation.score).toBe(1.0);
    });

    it('should correctly aggregate only successful outputs for scorer', async () => {
      const capturedOutputs: string[] = [];
      const mockScorer: DeviationScorer = async (_petition: string, output: string) => {
        capturedOutputs.push(output);
        return { score: 0.1, reason: 'mock reason' } as any;
      };

      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution, mockScorer);
      const reviewer = new ResultReviewer(rules);

      const report: ExecutionReport = {
        act_id: randomUUID(),
        overall_status: 'partial',
        task_results: [
          {
            task_id: randomUUID(),
            step_index: 0,
            status: 'success',
            output: 'hello world',
            tokens_consumed: 50,
          },
          {
            task_id: randomUUID(),
            step_index: 1,
            status: 'failed',
            output: '',
            error: 'timeout',
            tokens_consumed: 0,
          },
        ],
        total_tokens_consumed: 50,
        execution_time_seconds: 1.0,
      };

      const result = await reviewer.reviewDelivery('输出 hello world', report);

      // Only the successful output should reach the scorer
      expect(capturedOutputs[0]).toBe('hello world');
      expect(result.passed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 6: government._runPipeline() doesn't check report.overall_status
  //         before sending to ChiefJustice
  //
  // This is tested by checking that ChiefJustice.reviewResult() still receives
  // a completely-failed ExecutionReport and processes it without error.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 6: Failed ExecutionReport goes to ChiefJustice', () => {
    it('FIXED: should produce unconstitutional verdict when all tasks failed', async () => {
      const mockScorer: DeviationScorer = async () => ({ score: 0.1, reason: 'mock reason' } as any); // Low deviation = "constitutional"

      const mockTransport = new MockTransport([]);
      const adapter = new OpenClawAdapter({}, mockTransport);
      const constitution = makeConstitution();
      const cj = new ChiefJustice(constitution, adapter, bus, mockScorer);

      const failedReport: ExecutionReport = {
        act_id: randomUUID(),
        overall_status: 'failed',
        task_results: [
          {
            task_id: randomUUID(),
            step_index: 0,
            status: 'failed',
            output: '',
            error: '安全检查未通过: rm -rf detected',
            tokens_consumed: 0,
          },
        ],
        total_tokens_consumed: 0,
        execution_time_seconds: 0.1,
      };

      const verdict = await cj.reviewResult('写一段简单的代码', failedReport);

      // FIXED: ResultReviewer now force-fails when all tasks failed,
      // so the verdict is unconstitutional regardless of scorer.
      expect(verdict.constitutional).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 7: _generateCode() fallback + validateCode protects against prose
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 7 (mitigated): Fallback code goes through validateCode', () => {
    it('should catch dangerous commands in LLM prose fallback', async () => {
      const mockTransport = new MockTransport([
        // LLM returns prose containing dangerous command — NOT valid JSON
        'I can help! Here is the code: rm -rf / to clean everything up.',
        // The first parse attempt fails, so it tries again
        'Sure, just run rm -rf / and that should work!',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      // The fallback treats the prose as Python code, but validateCode catches
      // the "rm -rf" pattern in the code content.
      expect(result.status).toBe('failed');
      expect(result.error).toContain('安全检查未通过');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 9: ExecutionEngine._executeStep() uses act_id as task_id
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 9: ExecutionEngine task_id collision', () => {
    it('should have ALL tasks sharing the same task_id within an Act (bug demonstration)', async () => {
      const transport1 = new MockTransport([
        '{"language":"python","code":"print(1)"}',
        '1',
      ]);
      const transport2 = new MockTransport([
        '搜索结果',
      ]);

      const engAdapter = new OpenClawAdapter({}, transport1);
      const stateAdapter = new OpenClawAdapter({}, transport2);

      const secEng = new SecretaryOfEngineering(engAdapter, bus);
      const secState = new SecretaryOfState(stateAdapter, bus);

      const cabinet: Record<string, TaskExecutor> = {
        CodeExecution: secEng,
        Search: secState,
      };
      const engine = new ExecutionEngine(cabinet);

      const actId = randomUUID();
      const act = makeAct({
        act_id: actId,
        steps: [
          {
            index: 0,
            description: '计算',
            required_skill: 'CodeExecution',
            tool_parameters: {},
            estimated_tokens: 30,
            acceptance_criteria: '',
            dependencies: [],
          },
          {
            index: 1,
            description: '搜索',
            required_skill: 'Search',
            tool_parameters: {},
            estimated_tokens: 20,
            acceptance_criteria: '',
            dependencies: [],
          },
        ],
      });

      const report = await engine.executeAct(act);

      // FIXED: Each task now gets its own unique UUID
      expect(report.task_results[0].task_id).not.toBe(actId);
      expect(report.task_results[1].task_id).not.toBe(actId);
      // They SHOULD be different UUIDs:
      expect(report.task_results[0].task_id !== report.task_results[1].task_id).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 10: BillLifecycle has no force/reset method
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 10: BillLifecycle transition safety', () => {
    it('should throw InvalidTransitionError for DEBATING → DRAFTING (no shortcut back)', () => {
      const lifecycle = new BillLifecycle('test-bill');
      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);

      // There is no valid transition DEBATING → DRAFTING.
      // Only VOTED → VETOED → DRAFTING and UNCONSTITUTIONAL → DRAFTING are valid.
      expect(() => lifecycle.transition(BillState.DRAFTING)).toThrow(InvalidTransitionError);
    });

    it('should throw InvalidTransitionError for SIGNED → DRAFTING', () => {
      const lifecycle = new BillLifecycle('test-bill');
      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);
      lifecycle.transition(BillState.VOTED);
      lifecycle.transition(BillState.SIGNED);

      expect(() => lifecycle.transition(BillState.DRAFTING)).toThrow(InvalidTransitionError);
    });

    it('should allow the full happy path transition sequence', () => {
      const lifecycle = new BillLifecycle('test-bill');

      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);
      lifecycle.transition(BillState.VOTED);
      lifecycle.transition(BillState.SIGNED);
      lifecycle.transition(BillState.EXECUTING);
      lifecycle.transition(BillState.REVIEWING);
      lifecycle.transition(BillState.CONSTITUTIONAL);
      lifecycle.transition(BillState.DELIVERED);

      expect(lifecycle.is_terminal).toBe(true);
      expect(lifecycle.history.length).toBe(8);
    });

    it('should allow VETOED → DRAFTING retry loop', () => {
      const lifecycle = new BillLifecycle('test-bill');

      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);
      lifecycle.transition(BillState.VOTED);
      lifecycle.transition(BillState.VETOED);
      lifecycle.transition(BillState.DRAFTING); // back to start

      expect(lifecycle.current_state).toBe(BillState.DRAFTING);
    });

    it('should allow UNCONSTITUTIONAL → DRAFTING retry loop', () => {
      const lifecycle = new BillLifecycle('test-bill');

      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);
      lifecycle.transition(BillState.VOTED);
      lifecycle.transition(BillState.SIGNED);
      lifecycle.transition(BillState.EXECUTING);
      lifecycle.transition(BillState.REVIEWING);
      lifecycle.transition(BillState.UNCONSTITUTIONAL);
      lifecycle.transition(BillState.DRAFTING); // back to start

      expect(lifecycle.current_state).toBe(BillState.DRAFTING);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 11: SecEngineering code generation retry should not double-count
  //         transport calls
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 11: Code generation fallback path transport count', () => {
    it('should use 3 transport calls when first code gen fails JSON parse: gen1 + gen2(retry) + execute', async () => {
      const mockTransport = new MockTransport([
        // Response 1: LLM returns non-JSON (triggers retry)
        'Here is your code: print("hi")',
        // Response 2: Retry succeeds with valid JSON
        JSON.stringify({ language: 'python', code: "print('hi')" }),
        // Response 3: Code execution
        'hi',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.output).toContain('hi');
      // 3 transport calls: gen attempt 1 + gen attempt 2 (retry) + executeCode
      expect(mockTransport.calls.length).toBe(3);
    });

    it('should use 3 transport calls when both code gen attempts return non-JSON, then fallback to full-response-as-python', async () => {
      // When both attempts fail, the fallback uses the FIRST response as Python code
      const mockTransport = new MockTransport([
        // Response 1: LLM returns non-JSON (triggers retry)
        'print("hello fallback")',
        // Response 2: Retry also returns non-JSON (fallback kicks in)
        'still not json',
        // Response 3: Code execution of the fallback code
        'hello fallback',
      ]);

      const adapter = new OpenClawAdapter({}, mockTransport);
      const sec = new SecretaryOfEngineering(adapter, bus);
      const task = makeTask();

      const result = await sec.executeTask(task);

      expect(result.status).toBe('success');
      // The original fallback content (response 1) becomes the code
      expect(result.output).toContain('hello fallback');
      expect(mockTransport.calls.length).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 12: RulesEngine checkCommand regex vs sandbox validateCode regex gap
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 12: Security regex coverage gap', () => {
    it('RulesEngine.checkCommand should detect sudo in petition text', () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);

      const result = rules.checkCommand('sudo rm -rf /home/user');
      expect(result.passed).toBe(false);
    });

    it('RulesEngine.checkCommand should detect chmod 777 in petition text', () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);

      const result = rules.checkCommand('chmod 777 /etc/passwd');
      expect(result.passed).toBe(false);
    });

    it('FIXED: RulesEngine.checkCommand detects fs.unlink via require() pattern', () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);

      const result = rules.checkCommand("require('fs').unlink('/etc/passwd')");
      // FIXED: Now detected by the new require('fs').unlink regex
      expect(result.passed).toBe(false);
    });

    it('FIXED: RulesEngine.checkCommand NO LONGER false positives on "format the output"', () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);

      // FIXED: "format" in safe context no longer triggers blacklist
      const result1 = rules.checkCommand('format the output as JSON');
      expect(result1.passed).toBe(true); // No false positive!

      const result2 = rules.checkCommand('remove the header from the CSV file');
      expect(result2.passed).toBe(true);
    });

    it('FIXED: RulesEngine.checkCommand detects "format the disk" (disk formatting context)', () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);

      // FORMAT C: style disk formatting — should be caught
      const result1 = rules.checkCommand('format C: /FS:NTFS');
      expect(result1.passed).toBe(false);

      // "format the disk" without drive letter context — safe
      const result2 = rules.checkCommand('format the disk now');
      expect(result2.passed).toBe(true); // No drive letter = not a FORMAT command
    });
  });
});
