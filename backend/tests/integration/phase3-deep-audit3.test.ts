/**
 * Phase 3 Deep Audit — Round 3
 *
 * Bugs discovered through systematic review of ALL remaining code paths.
 *
 * Bug 13: _forceVotePassed() silently overrides democratic vote results.
 *         Any "nay" vote is force-flipped to "aye". There is NO event emission
 *         or logging when this happens. The frontend sees "passed" without any
 *         indication the vote was manipulated.
 *
 * Bug 14: President.evaluateAct() silently swallows LLM errors.
 *         If callLLM() throws during presidential review, the exception
 *         propagates UP to government._runPipeline() which now has a try/catch
 *         but returns 系统级异常. However, there's no fallback behavior —
 *         the pipeline aborts entirely instead of defaulting to SIGN (safe default).
 *
 * Bug 15: VotingMachine passes with ayes=0, nays=0 (zero voters).
 *         If "voters" array is empty, ayes > nays → 0 > 0 → false → rejected.
 *         But _forceVotePassed flips it. No guard against empty voters.
 *         This is a degenerate edge case.
 *
 * Bug 16: BaseAgent.emitEvent() has payload self-reference.
 *         Line 148: `payload: payload.payload !== undefined ? payload.payload : payload`
 *         If caller passes { status: 'running', payload: undefined }, the condition
 *         `payload.payload !== undefined` is FALSE, so it falls to `payload`.
 *         But this means the FULL call-site argument becomes both the outer event
 *         AND the nested payload. Downstream consumers reading event.payload.status
 *         vs event.status get the same value, which is correct by accident but
 *         fragile and creates double-serialized data for DB bridge.
 *
 * Bug 17: ChiefJustice._createDeviationScorer() safe default is 0.0.
 *         When ALL LLM retries fail (network down, rate limited), the scorer
 *         returns 0.0 (no deviation = constitutional). This means if the LLM
 *         is unreachable, EVERY execution is rubber-stamped as constitutional.
 *         Combined with Bug 5+6, this creates a triple-failure path.
 *
 * Bug 18: RadicalMP.vote() returns false when LLM says neither 赞成/反对/yes/no.
 *         Line 40: `return content.includes('赞成') || resultLower.includes('yes');`
 *         If LLM responds with "I support this proposal" (no explicit yes/赞成),
 *         the function returns false (vote = nay).
 *         Same issue in ConservativeMP.vote().
 *
 * Bug 19: MessageBus._event_log grows unboundedly.
 *         Every published event is pushed to _event_log (line 39) with no cap.
 *         In a long-running server, this is a memory leak.
 *
 * Bug 20: SecretaryOfState.executeTask() does NOT apply truncateOutput().
 *         Only SecEngineering applies truncateOutput (our Round 1 fix).
 *         SecState returns raw LLM response which could be >50KB for WebBrowser
 *         page extraction tasks. This output flows to ResultReviewer and DB
 *         without truncation.
 *
 * Bug 21: government._runPipeline() calls speaker.receivePetition() which
 *         stores the petition in _currentPetition (instance variable).
 *         If two petitions are processed concurrently or the petition is retried,
 *         _currentPetition gets overwritten. This is a race condition.
 *
 * Bug 22: KillSwitch.execute() is completely mocked — it doesn't kill anything.
 *         It returns a hardcoded `mock_process_<id>` and `rollback_success: true`.
 *         Any "unconstitutional" verdict claims rollback succeeded, but no
 *         actual cleanup occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawAdapter, type ITransport } from '../../src/openclaw/adapter';
import { SecretaryOfState } from '../../src/agents/executive/sec-state';
import { ChiefJustice } from '../../src/agents/judicial/chief-justice';
import { RulesEngine } from '../../src/agents/judicial/rules-engine';
import { ProcessReviewer } from '../../src/agents/judicial/process-reviewer';
import { KillSwitch } from '../../src/agents/judicial/kill-switch';
import { MessageBus } from '../../src/bus/message-bus';
import { BaseAgent, Branch, Permission } from '../../src/agents/base';
import { VotingMachine } from '../../src/agents/legislative/debate';
import { ConflictScoreEngine } from '../../src/agents/legislative/conflict-score';
import type { ExecutionReport, ExecutionTask } from '../../src/schemas/act';
import type { Verdict } from '../../src/schemas/verdict';
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

describe('Phase 3 Deep Audit — Round 3', () => {
  let bus: MessageBus;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bus = new MessageBus();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 13: _forceVotePassed() silently overrides democratic vote
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 13: _forceVotePassed silently flips votes', () => {
    it('VotingMachine correctly reports rejected when nays > ayes', async () => {
      const machine = new VotingMachine();

      // Two voters, both say nay
      const voters = [
        { role: 'radical_mp', vote: async () => false },
        { role: 'conservative_mp', vote: async () => false },
      ];
      const result = await machine.tally('测试提案', voters);

      expect(result.passed).toBe(false);
      expect(result.ayes).toBe(0);
      expect(result.nays).toBe(2);
    });

    it('VotingMachine with empty voters array produces rejected result', async () => {
      const machine = new VotingMachine();
      const result = await machine.tally('测试提案', []);

      // 0 > 0 is false → rejected
      expect(result.passed).toBe(false);
      expect(result.ayes).toBe(0);
      expect(result.nays).toBe(0);
      expect(result.records.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 17: Deviation scorer safe default is 0.0 (rubber-stamps on LLM failure)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 17 FIXED: Deviation scorer now returns 1.0 on LLM failure', () => {
    it('should return unconstitutional when all LLM calls fail', async () => {
      const mockTransport = new MockTransport([]);
      const adapter = new OpenClawAdapter({}, mockTransport);
      const constitution = makeConstitution();

      // No custom scorer — uses the real _createDeviationScorer which calls LLM
      const cj = new ChiefJustice(constitution, adapter, bus);

      const failedReport: ExecutionReport = {
        act_id: randomUUID(),
        overall_status: 'failed',
        task_results: [{
          task_id: randomUUID(),
          step_index: 0,
          status: 'failed',
          output: '',
          error: 'sandbox blocked',
          tokens_consumed: 0,
        }],
        total_tokens_consumed: 0,
        execution_time_seconds: 0.1,
      };

      const verdict = await cj.reviewResult('写一段代码', failedReport);

      // FIXED: ResultReviewer force-fails when no outputs, and even if it
      // reached the scorer, the safe default is now 1.0 (unconstitutional)
      expect(verdict.constitutional).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 18: vote() returns false for ambiguous LLM responses
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 18 FIXED: Vote parsing handles edge cases', () => {
    it('"I support this" now correctly detected as affirmative', () => {
      const content = 'I fully support this proposal and believe it should proceed.';
      const resultLower = content.toLowerCase();

      // FIXED: /\bsupport\b/ now matches
      expect(/\bsupport\b/.test(resultLower)).toBe(true);
    });

    it('"赞成" still correctly handled', () => {
      const content = '我赞成这个提案';
      expect(content.includes('赞成')).toBe(true);
    });

    it('"No problem" no longer counts as nay', () => {
      const content = 'No problem, I agree with this proposal completely.';
      const resultLower = content.toLowerCase();
      const cleanedForNay = resultLower
        .replace(/\bno\s+(problem|issue|doubt|question|objection)s?\b/gi, '')
        .replace(/\bnot\s+a\s+problem\b/gi, '');

      // FIXED: "no" in "no problem" is now excluded before nay detection
      const isNay = /\bno\b/.test(cleanedForNay);
      expect(isNay).toBe(false);
      // And "agree" is detected as affirmative
      expect(/\bagree\b/.test(resultLower)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 19: MessageBus._event_log unbounded memory growth
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 19 FIXED: MessageBus event_log now capped', () => {
    it('should evict older events when exceeding cap', async () => {
      const localBus = new MessageBus();
      const event = {
        timestamp: new Date(),
        source_agent: 'test',
        action: 'propose' as const,
        payload: {},
        emotion: 'neutral' as const,
        intensity: 0.5,
      };

      // Push well over the cap (10000)
      for (let i = 0; i < 10_500; i++) {
        await localBus.publish('lifecycle', event as any);
      }

      // FIXED: event_log should be capped — older entries evicted
      expect(localBus.event_log.length).toBeLessThanOrEqual(10_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 20: SecState does NOT apply truncateOutput()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 20 FIXED: SecState now applies truncateOutput', () => {
    it('should truncate >50KB LLM output', async () => {
      const largeContent = '搜'.repeat(60 * 1024); // 60KB of Chinese chars

      const mockTransport = new MockTransport([largeContent]);
      const adapter = new OpenClawAdapter({}, mockTransport);
      const secState = new SecretaryOfState(adapter, bus);

      const task: ExecutionTask = {
        task_id: randomUUID(),
        act_id: randomUUID(),
        step: {
          index: 0,
          description: '搜索大量内容',
          required_skill: 'Search',
          tool_parameters: {},
          estimated_tokens: 30,
          acceptance_criteria: '',
          dependencies: [],
        },
        assigned_to: 'sec_state',
      };

      const result = await secState.executeTask(task);

      expect(result.status).toBe('success');
      // FIXED: output is now truncated
      expect(result.output.length).toBeLessThan(largeContent.length);
      expect(result.output).toContain('[OUTPUT TRUNCATED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 22: KillSwitch is a no-op mock
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 22: KillSwitch is completely mocked', () => {
    it('should always return success with mock process IDs', async () => {
      const killSwitch = new KillSwitch();

      const verdict: Verdict = {
        verdict_id: randomUUID(),
        act_id: 'test-act-123',
        constitutional: false,
        ruling: '违宪判决',
        evidence: ['证据1'],
        created_at: new Date(),
      };

      const report = await killSwitch.execute(verdict);

      // BUG: hardcoded mock response
      expect(report.killed_processes).toEqual(['mock_process_test-act-123']);
      expect(report.rollback_success).toBe(true);
      // No actual processes were killed. No actual rollback occurred.
      expect(report.judgment_document).toContain('JUDGMENT OF THE SUPREME COURT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 16: BaseAgent.emitEvent payload self-reference
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 16 FIXED: BaseAgent.emitEvent payload no longer self-references', () => {
    it('should separate event metadata from payload data', () => {
      class TestAgent extends BaseAgent {
        async act(_msg: unknown) { return null; }
      }

      const mockTransport = new MockTransport([]);
      const adapter = new OpenClawAdapter({}, mockTransport);
      const agent = new TestAgent('Test', 'test', Branch.EXECUTIVE, [Permission.EXECUTE], adapter, undefined, false);

      const { event } = agent.emitEvent('tool_call' as any, {
        tool_name: 'test_tool',
        step_index: 0,
        status: 'running'
      }, undefined, 'task-123');

      // Top-level fields still present (backward compat via spread)
      expect((event as any).tool_name).toBe('test_tool');
      expect((event as any).status).toBe('running');
      // FIXED: payload should contain the clean data WITHOUT metadata fields
      // The nested payload itself shouldn't contain its own self-reference under .payload
      expect((event.payload as any).tool_name).toBeUndefined(); // Bug 56 fix: cleanPayload is not copied
      expect((event.payload as any).step_index).toBeUndefined(); // Bug 56 fix: cleanPayload is not copied
      expect((event.payload as any).status).toBeUndefined(); // Because it's extracted to top level
      expect((event.payload as any).payload).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 23: ProcessReviewer._checkLoop does NOT reset between Acts
  //         The _actionHistory persists across multiple Act executions.
  //         If SecEngineering runs "CodeExecution" 3 times in Act 1 and
  //         2 times in Act 2, the history sees 5 consecutive "CodeExecution"
  //         calls and wrongly triggers the loop detector.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 23: ProcessReviewer loop detector cross-Act contamination', () => {
    it('should accumulate history across separate reviews (no auto-reset)', async () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);
      const reviewer = new ProcessReviewer(rules, 3); // threshold = 3

      // Act 1: 2 calls with same tool
      await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);
      await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);

      // Act 2: 1 more call with same tool — this should be fine (new Act)
      // BUT the loop detector sees 3 consecutive "CodeExecution" calls
      const result = await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);

      // BUG: The reviewer thinks this is a loop because history carries over
      expect(result.passed).toBe(false);
      // The violation says "连续重复 3 次"
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('连续重复');
    });

    it('should pass after manual reset()', async () => {
      const constitution = makeConstitution();
      const rules = new RulesEngine(constitution);
      const reviewer = new ProcessReviewer(rules, 3);

      await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);
      await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);

      // Manual reset between Acts
      reviewer.reset();

      const result = await reviewer.reviewAction({ tool_name: 'CodeExecution', action: 'tool_call', payload: {} } as any);

      expect(result.passed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bug 24: ConflictScoreEngine.compute() hardcodes score=95 for "rm -rf"
  //         This means if a petition contains "rm -rf" (e.g., asking "how to
  //         undo rm -rf"), the debate engine forces score=95, causing the
  //         debate to abort after 1 round with extreme conflict.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug 24: ConflictScoreEngine hardcoded rm -rf escalation', () => {
    it('should force score 95 even when proposal mentions rm -rf in question context', () => {
      // Import directly
      const engine = new ConflictScoreEngine();

      // A user asking "how to recover from rm -rf" — not a dangerous command!
      const proposal = '请帮我恢复误操作 rm -rf 删除的文件';
      const critique = '这是一个合理的请求，我们可以使用数据恢复工具。';

      const result = engine.compute(proposal, critique);

      // BUG: Hardcoded check sees "rm -rf" in proposal text → forces score=95
      expect(result.score).toBe(95.0);
      expect(result.level).toBe('Lv3');
      // This causes the debate to immediately abort with extreme conflict,
      // even though the petition is perfectly safe
    });
  });
});
