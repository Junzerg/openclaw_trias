/**
 * Phase 1 · 端到端联调测试
 *
 * Mock 层级：只在 OpenClawAdapter.callLLM 层 Mock（模拟 LLM 返回），
 * 让所有内部逻辑（ConflictScoreEngine、RulesEngine、BillLifecycle、
 * ExecutionEngine 等）真实运行。
 *
 * Constitution config (debate rules):
 *   min_rounds: 2, max_rounds: 10
 *   consensus_threshold: 30 (score < 30 = consensus)
 *   conflict_threshold: 80 (score > 80 = speaker intervenes)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { resolve } from 'path';
import { CyberGovernment } from '../../src/government';
import { BillState, BillLifecycle, InvalidTransitionError } from '../../src/bus/state-machine';
import { EventAction, JudgmentEvent } from '../../src/schemas/events';
import { PermissionDeniedError, Permission } from '../../src/agents/base';
import { OpenClawAdapter, type LLMResponse } from '../../src/openclaw/adapter';
import { MessageBus } from '../../src/bus/message-bus';
import { DebateRecord, ActVoteRecord } from '../../src/schemas/act';
import { ViolationType } from '../../src/schemas/verdict';
import { ConflictScoreEngine } from '../../src/agents/legislative/conflict-score';

const configDir = resolve(__dirname, '../../../config');

// ─── Helper: Build a CyberGovernment with mocked adapter.callLLM ─────────────

/**
 * Creates a CyberGovernment instance and mocks `adapter.callLLM` with a
 * sequential response queue. This lets us control every LLM interaction
 * while letting all internal logic run real.
 */
function createMockedGov(callLLMResponses: string[]): {
  gov: CyberGovernment;
  callLLMSpy: MockInstance<(systemPrompt: string, userMessage: string, model?: string) => Promise<LLMResponse>>;
} {
  const gov = new CyberGovernment(configDir);
  const responseQueue = [...callLLMResponses];

  const callLLMSpy = vi.spyOn(gov.adapter, 'callLLM').mockImplementation(
    async (_systemPrompt: string, _userMessage: string) => {
      const content = responseQueue.shift() ?? '[Mock] 默认回复';
      return { content, rawOutput: content };
    }
  );

  vi.spyOn(gov.adapter, 'executeCode').mockResolvedValue({
    stdout: 'Mocked execution output',
    stderr: '',
    exitCode: 0,
    rawOutput: 'Mocked execution output'
  });

  return { gov, callLLMSpy };
}

// ─── Helper: Common LLM response patterns ────────────────────────────────────

/*
 * Debate call sequence (with constitution config min_rounds=2):
 *
 * 1. radical.propose(petition) → LLM call
 * LOOP (round 1..max_rounds):
 *   2. round==1 ? conservative.critique(proposal) : conservative.rebut(proposal) → LLM call
 *   3. IF score > conflict_threshold:
 *        speaker.intervene(proposal, critique, score) → LLM call
 *        IF score >= 90: break (forced)
 *   4. IF score < consensus_threshold && round >= min_rounds: break
 *   5. IF round < max_rounds: radical.rebut(critique) → LLM call, becomes new proposal
 *
 * After debate:
 *   6. radical.vote(proposal) → LLM call
 *   7. conservative.vote(proposal) → LLM call
 *   8. speaker.generateAct internal callLLM → LLM call
 *   9. president.evaluateAct: IF no token/skill issue → callLLM → LLM call
 *   10. chiefJustice deviation scorer → LLM call
 */

/**
 * Low-conflict debate: converges after min_rounds (2).
 * Produces mild text so ConflictScoreEngine gives score < 30.
 *
 * LLM sequence:
 *   1. radical.propose → mild proposal
 *   2. conservative.critique → mild critique (score < 30, but round 1 < min_rounds so continue)
 *   3. radical.rebut → compromise (becomes new proposal for round 2)
 *   4. conservative.rebut → agree, score < 30 and round 2 >= min_rounds → break
 */
function lowConflictDebateResponses(): string[] {
  return [
    // 1. radical.propose
    '我建议使用最新的技术栈来实现这个功能，考虑到性能和可维护性。',
    // 2. conservative.critique (round 1) — mild, few opposition keywords, some compromise
    '可以考虑更稳妥的方案。我部分同意这个思路，有道理，可以接受。妥协也行。',
    // 3. radical.rebut (round 1) — becomes new proposal
    '好的，我接受你的建议，可以考虑折中方案。部分同意你的看法。妥协可以接受。有道理。',
    // 4. conservative.rebut (round 2) — agree, triggers consensus since score < 30
    '有道理，我接受这种折中。可以考虑。部分同意。妥协可以接受。同意。认同。',
  ];
}

/** Standard vote + generateAct + president sign + constitutional */
function postDebateHappyPath(): string[] {
  return [
    '赞成',  // radical.vote
    '赞成',  // conservative.vote
    '{"description": "步骤1: 使用 CodeExecution 技能", "estimated_tokens": 100, "required_skill": "CodeExecution"}',  // speaker.generateAct LLM
    '[SIGN]',  // president.evaluateAct LLM
    '{"language": "python", "code": "print(\\"Hello\\")"}', // SecEngineering code gen
    '{"score": 0.1, "reason": "执行内容与请愿高度匹配"}',  // chiefJustice deviation
  ];
}

/** Post-debate path ending with VETO */
function postDebateVetoPath(): string[] {
  return [
    '赞成',
    '赞成',
    '{"description": "步骤1: 使用 CodeExecution 技能", "estimated_tokens": 100, "required_skill": "CodeExecution"}',
    '[VETO: 法案存在重大安全隐患]',  // president VETO
  ];
}

/** Post-debate path ending with UNCONSTITUTIONAL */
function postDebateUnconstitutionalPath(): string[] {
  return [
    '赞成',
    '赞成',
    '{"description": "步骤1: 使用 CodeExecution 技能", "estimated_tokens": 100, "required_skill": "CodeExecution"}',
    '[SIGN]',
    '{"language": "python", "code": "print(\\"Hello\\")"}', // SecEngineering code gen
    '{"score": 0.8, "reason": "严重偏离原始请愿"}',  // unconstitutional
  ];
}

/** Full happy pipeline = low conflict debate + post debate happy */
function fullHappyPipeline(): string[] {
  return [...lowConflictDebateResponses(), ...postDebateHappyPath()];
}

/**
 * High-conflict debate responses (Lv2: score > 80).
 * LLM calls:
 *   1. radical.propose — aggressive
 *   2. conservative.critique (round 1) — many opposition + intensity keywords → score > 80
 *   3. speaker.intervene (triggered by score > 80)
 *   4. radical.rebut (round 1)
 *   5. conservative.rebut (round 2) — still hostile
 *   6. speaker.intervene (if still > 80)
 *   7. radical.rebut (round 2)
 *   8. conservative.rebut (round 3) — calming down, compromise keywords
 *   ... continues until convergence or max_rounds
 */
function highConflictDebateResponses(): string[] {
  return [
    // 1. radical.propose
    '我们必须使用最前沿的技术！绝对不能妥协！',
    // 2. conservative.critique (round 1) — heavy opposition + intensity → score ~84 > 80
    '反对！反对！反对！不可行！荒谬！危险！非常错误！绝对不行！拒绝！不合理！不安全！必须反对！坚决反对！极其错误！完全不同意！！！！！！！',
    // 3. speaker.intervene (score > 80, triggered)
    '请双方冷静，我们应该理性讨论。',
    // 4. radical.rebut (round 1) — becoming moderate, lots of compromise keywords
    '我接受部分批评，可以考虑折中方案。部分同意。有道理。妥协可以接受。认同。',
    // 5. conservative.rebut (round 2) — calming down with lots of compromise
    '有道理，我部分同意。可以考虑折中。接受这个方案。认同。妥协可以接受。同意。',
    // After round 2 with compromise keywords, score should be < 30, consensus reached
  ];
}

/**
 * Extreme-conflict debate (Lv3: score >= 90, forced break).
 * The rm -rf in proposal triggers ConflictScoreEngine emergency score of 95.
 */
function extremeConflictDebateResponses(): string[] {
  return [
    // 1. radical.propose — contains rm -rf which triggers score=95
    '执行 rm -rf / 来清理系统',
    // 2. conservative.critique (round 1) — intense opposition
    '反对！这绝对不行！',
    // 3. speaker.intervene (score 95 > 80)
    '紧急控场！请双方立刻停止！',
    // score >= 90 → forced break, no more rebuttals
  ];
}

/**
 * Multi-round debate that doesn't converge (moderate conflict stays between 30-80).
 * Will run until max_rounds.
 */
function multiRoundDebateResponses(maxRounds: number = 10): string[] {
  const responses: string[] = [];
  // 1. radical.propose
  responses.push('我提议使用前沿技术，这非常重要！');
  for (let r = 1; r <= maxRounds; r++) {
    // conservative critique/rebut — moderate opposition (score 30~80)
    responses.push('我反对这种做法！不可行！但我不完全否定。');
    // If r < maxRounds and score is not < consensus, radical rebuts
    if (r < maxRounds) {
      responses.push('我坚持我的观点，但可以考虑调整。');
    }
  }
  return responses;
}


// =============================================================================
// TEST SUITES
// =============================================================================

describe('Phase 1 端到端联调测试', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // 1. 生命周期主路径 (Happy Path)
  // ===========================================================================
  describe('1. 生命周期主路径 (Happy Path)', () => {
    it('E2E-HP-01: PETITION → DELIVERED 完整成功路径', async () => {
      const { gov, callLLMSpy } = createMockedGov(fullHappyPipeline());
      await gov.inaugurate();

      const result = await gov.receivePetition('请实现一个简单的计算器应用');

      expect(result).toContain('已交付');
      expect(callLLMSpy).toHaveBeenCalled();

      // Verify lifecycle events
      const stateChanges = gov.bus.event_log.filter(e => e.action === EventAction.STATE_CHANGE);
      expect(stateChanges.length).toBeGreaterThan(0);

      // Verify sign event was emitted
      const signEvents = gov.bus.event_log.filter(e => e.action === EventAction.SIGN_ACT);
      expect(signEvents.length).toBe(1);

      // Verify constitutional event
      const constEvents = gov.bus.event_log.filter(e => e.action === EventAction.CONSTITUTIONAL);
      expect(constEvents.length).toBe(1);

      await gov.shutdown();
    });
  });

  // ===========================================================================
  // 2. 回路路径 (Retry Loops)
  // ===========================================================================
  describe('2. 回路路径 (Retry Loops)', () => {
    it('E2E-VETO-01: 总统否决 → 重试成功 → DELIVERED', async () => {
      const responses = [
        // --- Attempt 1: debate + VETO ---
        ...lowConflictDebateResponses(),
        ...postDebateVetoPath(),
        // --- Attempt 2: debate + SIGN + CONSTITUTIONAL ---
        ...lowConflictDebateResponses(),
        ...postDebateHappyPath(),
      ];

      const { gov } = createMockedGov(responses);
      await gov.inaugurate();

      const result = await gov.receivePetition('请实现一个TODO应用', 2);
      expect(result).toContain('已交付');

      const vetoEvents = gov.bus.event_log.filter(e => e.action === EventAction.VETO);
      expect(vetoEvents.length).toBe(1);

      await gov.shutdown();
    });

    it('E2E-VETO-02: 连续总统否决 → 耗尽重试', async () => {
      const responses = [
        ...lowConflictDebateResponses(),
        ...postDebateVetoPath(),
        ...lowConflictDebateResponses(),
        ...postDebateVetoPath(),
      ];

      const { gov } = createMockedGov(responses);
      await gov.inaugurate();

      const result = await gov.receivePetition('请实现一个TODO应用', 2);
      expect(result).toContain('次重试后仍未通过');

      await gov.shutdown();
    });

    it('E2E-UNCN-01: 违宪驳回 → 重试成功 → DELIVERED', async () => {
      const responses = [
        ...lowConflictDebateResponses(),
        ...postDebateUnconstitutionalPath(),
        ...lowConflictDebateResponses(),
        ...postDebateHappyPath(),
      ];

      const { gov } = createMockedGov(responses);
      await gov.inaugurate();

      const result = await gov.receivePetition('请帮我写一个日历', 2);
      expect(result).toContain('已交付');

      const unconEvents = gov.bus.event_log.filter(e => e.action === EventAction.UNCONSTITUTIONAL);
      expect(unconEvents.length).toBe(1);

      await gov.shutdown();
    });

    it('E2E-UNCN-02: 连续违宪 → 耗尽重试', async () => {
      const responses = [
        ...lowConflictDebateResponses(),
        ...postDebateUnconstitutionalPath(),
        ...lowConflictDebateResponses(),
        ...postDebateUnconstitutionalPath(),
      ];

      const { gov } = createMockedGov(responses);
      await gov.inaugurate();

      const result = await gov.receivePetition('测试请愿', 2);
      expect(result).toContain('次重试后仍未通过');

      await gov.shutdown();
    });

    it('E2E-MIX-01: 第一轮否决 + 第二轮违宪 → 耗尽', async () => {
      const responses = [
        ...lowConflictDebateResponses(),
        ...postDebateVetoPath(),
        ...lowConflictDebateResponses(),
        ...postDebateUnconstitutionalPath(),
      ];

      const { gov } = createMockedGov(responses);
      await gov.inaugurate();

      const result = await gov.receivePetition('混合测试', 2);
      expect(result).toContain('次重试后仍未通过');

      const vetoEvents = gov.bus.event_log.filter(e => e.action === EventAction.VETO);
      const unconEvents = gov.bus.event_log.filter(e => e.action === EventAction.UNCONSTITUTIONAL);
      expect(vetoEvents.length).toBe(1);
      expect(unconEvents.length).toBeGreaterThanOrEqual(1);

      await gov.shutdown();
    });
  });

  // ===========================================================================
  // 3. 辩论引擎分支 (DebateEngine)
  // ===========================================================================
  describe('3. 辩论引擎分支 (DebateEngine)', () => {
    it('E2E-DEB-01: 正常收敛（Lv1）— 低冲突在 min_rounds 后达成共识', async () => {
      const { gov } = createMockedGov([
        ...lowConflictDebateResponses(),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('请帮我做一个简单的笔记应用');
      expect(result).toContain('已交付');

      // No BRAWL events for low conflict (score < 80)
      const brawlEvents = gov.bus.event_log.filter(e => e.action === EventAction.BRAWL);
      expect(brawlEvents.length).toBe(0);

      await gov.shutdown();
    });

    it('E2E-DEB-02: 高冲突触发议长控场（Lv2）— score > conflict_threshold', async () => {
      const { gov } = createMockedGov([
        ...highConflictDebateResponses(),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('请实现一个激进的全新架构');
      expect(result).toContain('已交付');

      // BRAWL and ORDER events should have been emitted
      const brawlEvents = gov.bus.event_log.filter(e => e.action === EventAction.BRAWL);
      const orderEvents = gov.bus.event_log.filter(e => e.action === EventAction.ORDER);
      expect(brawlEvents.length).toBeGreaterThanOrEqual(1);
      expect(orderEvents.length).toBeGreaterThanOrEqual(1);

      await gov.shutdown();
    });

    it('E2E-DEB-03: 极端冲突强制终止（Lv3, score≥90）— 辩论 break', async () => {
      const { gov } = createMockedGov([
        ...extremeConflictDebateResponses(),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('极端测试请愿');
      expect(result).toContain('已交付');

      // BRAWL event should have fired
      const brawlEvents = gov.bus.event_log.filter(e => e.action === EventAction.BRAWL);
      expect(brawlEvents.length).toBeGreaterThanOrEqual(1);

      await gov.shutdown();
    });

    it('E2E-DEB-04: 达到 max_rounds 自然终止', async () => {
      const { gov } = createMockedGov([
        ...multiRoundDebateResponses(10),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('需要多轮辩论的复杂需求');
      expect(result).toContain('已交付');

      // Multiple PROPOSE events should exist (each speaker/MP emit fires)
      const proposeEvents = gov.bus.event_log.filter(e => e.action === EventAction.PROPOSE);
      expect(proposeEvents.length).toBeGreaterThan(2);

      await gov.shutdown();
    });
  });

  // ===========================================================================
  // 4. 行政分支 (Executive)
  // ===========================================================================
  describe('4. 行政分支 (Executive)', () => {
    it('E2E-EXE-01: 多步执行 + 部长路由正确性', async () => {
      const { gov } = createMockedGov([
        ...lowConflictDebateResponses(),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('实现代码功能');
      expect(result).toContain('已交付');

      const toolCallEvents = gov.bus.event_log.filter(e => e.action === EventAction.TOOL_CALL);
      expect(toolCallEvents.length).toBeGreaterThan(0);

      await gov.shutdown();
    });

    it('E2E-EXE-02: 步骤失败 → 下游跳过（单独测试 ExecutionEngine）', async () => {
      const { ExecutionEngine } = await import('../../src/agents/executive/engine');
      const { SecretaryOfEngineering } = await import('../../src/agents/executive/sec-engineering');
      const { SecretaryOfState } = await import('../../src/agents/executive/sec-state');

      const mockAdapter = { callLLM: vi.fn(), executeCode: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, rawOutput: 'ok' }) } as unknown as OpenClawAdapter;
      const mockBus = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as MessageBus;

      const secEng = new SecretaryOfEngineering(mockAdapter, mockBus);
      const secState = new SecretaryOfState(mockAdapter, mockBus);

      vi.spyOn(secEng, 'executeTask').mockImplementation(async (task) => {
        if (task.step.index === 0) {
          return { task_id: task.task_id, step_index: 0, status: 'failed', error: 'Build failed', tokens_consumed: 0, output: '' };
        }
        return { task_id: task.task_id, step_index: task.step.index, status: 'success', output: 'ok', tokens_consumed: 10 };
      });

      const engine = new ExecutionEngine({
        'CodeExecution': secEng,
        'Search': secState,
      });

      const act = {
        act_id: 'e2e-fail-test',
        title: 'Fail Test',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 100,
        steps: [
          { index: 0, description: 'Step A', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 50, acceptance_criteria: '', dependencies: [] },
          { index: 1, description: 'Step B', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 50, acceptance_criteria: '', dependencies: [0] },
        ],
        debate_record: { total_rounds: 0, final_conflict_score: 0, consensus_points: [], remaining_concerns: [] },
        vote_record: { ayes: 2, nays: 0, result: 'passed' as const, voter_positions: {} },
        created_at: new Date()
      };

      const report = await engine.executeAct(act);
      expect(report.task_results[0].status).toBe('failed');
      expect(report.task_results[1].status).toBe('skipped');
      expect(report.overall_status).toBe('failed');
    });

    it('E2E-EXE-03: Token 预算超限 → 总统否决', async () => {
      const { President } = await import('../../src/agents/executive/president');

      const mockAdapter = { callLLM: vi.fn(), executeCode: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, rawOutput: 'ok' }) } as unknown as OpenClawAdapter;
      const mockBus = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as MessageBus;
      const president = new President(mockAdapter, mockBus, 100);

      const act = {
        act_id: 'token-test',
        title: 'Over Budget Act',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 999999,
        steps: [
          { index: 0, description: '', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 999999, acceptance_criteria: '', dependencies: [] },
        ],
        debate_record: {} as DebateRecord,
        vote_record: {} as ActVoteRecord,
        created_at: new Date()
      };

      const vetoNotice = await president.evaluateAct(act);
      expect(vetoNotice).not.toBeNull();
      expect(vetoNotice!.specific_issues.some(i => i.includes('Token'))).toBe(true);
    });

    it('E2E-EXE-04: Skill 不可用 → 总统否决', async () => {
      const { President } = await import('../../src/agents/executive/president');

      const mockAdapter = { callLLM: vi.fn(), executeCode: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, rawOutput: 'ok' }) } as unknown as OpenClawAdapter;
      const mockBus = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as MessageBus;
      const president = new President(mockAdapter, mockBus);

      const act = {
        act_id: 'skill-test',
        title: 'Missing Skill Act',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 100,
        steps: [
          { index: 0, description: '', required_skill: 'NonExistentSkill', tool_parameters: {}, estimated_tokens: 100, acceptance_criteria: '', dependencies: [] },
        ],
        debate_record: {} as DebateRecord,
        vote_record: {} as ActVoteRecord,
        created_at: new Date()
      };

      const vetoNotice = await president.evaluateAct(act);
      expect(vetoNotice).not.toBeNull();
      expect(vetoNotice!.specific_issues.some(i => i.includes('NonExistentSkill'))).toBe(true);
    });

    it('E2E-EXE-05: 工程部长 & 国务卿路由验证', async () => {
      const { ExecutionEngine } = await import('../../src/agents/executive/engine');
      const { SecretaryOfEngineering } = await import('../../src/agents/executive/sec-engineering');
      const { SecretaryOfState } = await import('../../src/agents/executive/sec-state');

      const mockAdapter = { callLLM: vi.fn(), executeCode: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, rawOutput: 'ok' }) } as unknown as OpenClawAdapter;
      const mockBus = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as MessageBus;

      const secEng = new SecretaryOfEngineering(mockAdapter, mockBus);
      const secState = new SecretaryOfState(mockAdapter, mockBus);

      const engSpy = vi.spyOn(secEng, 'executeTask').mockResolvedValue({ task_id: '1', step_index: 0, status: 'success', output: 'ok', tokens_consumed: 10 } as any);
      const stateSpy = vi.spyOn(secState, 'executeTask').mockResolvedValue({ task_id: '1', step_index: 1, status: 'success', output: 'ok', tokens_consumed: 10 } as any);

      const engine = new ExecutionEngine({
        'CodeExecution': secEng,
        'Python_Interpreter': secEng,
        'GitHub': secEng,
        'WebBrowser': secState,
        'Search': secState,
      });

      const act = {
        act_id: 'route-test',
        title: 'Routing Test',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 100,
        steps: [
          { index: 0, description: 'Code task', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [] },
          { index: 1, description: 'Search task', required_skill: 'Search', tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [] },
        ],
        debate_record: { total_rounds: 0, final_conflict_score: 0, consensus_points: [], remaining_concerns: [] },
        vote_record: { ayes: 2, nays: 0, result: 'passed' as const, voter_positions: {} },
        created_at: new Date()
      };

      const report = await engine.executeAct(act);
      expect(report.overall_status).toBe('completed');
      expect(engSpy).toHaveBeenCalled();
      expect(stateSpy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 5. 司法分支 (Judicial)
  // ===========================================================================
  describe('5. 司法分支 (Judicial)', () => {
    it('E2E-JUD-01: 合宪通过 — deviation_score ≤ max_score', async () => {
      const { gov } = createMockedGov([
        ...lowConflictDebateResponses(),
        ...postDebateHappyPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('开发一个计时器');
      expect(result).toContain('已交付');

      const constitutionalEvents = gov.bus.event_log.filter(e => e.action === EventAction.CONSTITUTIONAL);
      expect(constitutionalEvents.length).toBe(1);

      await gov.shutdown();
    });

    it('E2E-JUD-02: 偏离度超标 → 违宪', async () => {
      const { gov } = createMockedGov([
        ...lowConflictDebateResponses(),
        ...postDebateUnconstitutionalPath(),
      ]);
      await gov.inaugurate();

      const result = await gov.receivePetition('偏离度测试', 1);
      expect(result).toContain('次重试后仍未通过');

      const unconEvents = gov.bus.event_log.filter(e => e.action === EventAction.UNCONSTITUTIONAL);
      expect(unconEvents.length).toBeGreaterThanOrEqual(1);

      await gov.shutdown();
    });

    it('E2E-JUD-03: 危险指令熔断（黑名单拦截）— 跳过 LLM 直接违宪', async () => {
      const { ChiefJustice } = await import('../../src/agents/judicial/chief-justice');
      const { loadConstitution } = await import('../../src/config/loader');

      const constitution = loadConstitution(configDir);
      const adapter = new OpenClawAdapter();
      const callLLMSpy = vi.spyOn(adapter, 'callLLM');

      const chief = new ChiefJustice(constitution, adapter);

      const report = {
        act_id: 'danger-test',
        overall_status: 'completed' as const,
        task_results: [{
          task_id: 't-1',
          step_index: 0,
          status: 'success' as const,
          output: 'Running command: rm -rf /',
          tokens_consumed: 10
        }],
        total_tokens_consumed: 10,
        execution_time_seconds: 1,
      };

      const verdict = await chief.reviewResult('请执行 rm -rf / 清空服务器', report);

      expect(verdict.constitutional).toBe(false);
      expect(verdict.ruling).toContain('违反 OpenClaw 第 1 条');
      expect(callLLMSpy).not.toHaveBeenCalled();
    });

    it('E2E-JUD-04: KillSwitch 触发 + 判决书生成', async () => {
      const { ChiefJustice } = await import('../../src/agents/judicial/chief-justice');
      const { loadConstitution } = await import('../../src/config/loader');

      const constitution = loadConstitution(configDir);
      const adapter = new OpenClawAdapter();
      const chief = new ChiefJustice(constitution, adapter);

      const mockBus = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as MessageBus;
      (chief as unknown as { bus: MessageBus }).bus = mockBus;

      const verdict = {
        verdict_id: 'v-killswitch',
        act_id: 'act-killswitch',
        constitutional: false,
        ruling: '违宪：执行了危险操作',
        violation_type: ViolationType.BLACKLIST_COMMAND,
        evidence: ['detected: rm -rf /'],
        created_at: new Date()
      };

      const judgmentEvent = await chief.issueJudgment(verdict);

      expect(judgmentEvent.action).toBe(EventAction.UNCONSTITUTIONAL);
      expect((judgmentEvent as JudgmentEvent).ruling).toBeDefined();
      expect((judgmentEvent as JudgmentEvent).traceback).toBeDefined();
    });
  });

  // ===========================================================================
  // 6. 消息总线 & 事件完整性 (MessageBus)
  // ===========================================================================
  describe('6. 消息总线 & 事件完整性', () => {
    it('E2E-BUS-01: 完整 pipeline 后事件日志包含所有阶段', async () => {
      const { gov } = createMockedGov(fullHappyPipeline());
      await gov.inaugurate();

      await gov.receivePetition('事件测试');

      const events = gov.bus.event_log;
      const actions = new Set(events.map(e => e.action));

      expect(actions.has(EventAction.STATE_CHANGE)).toBe(true);
      expect(actions.has(EventAction.VOTE_PASSED)).toBe(true);
      expect(actions.has(EventAction.TOOL_CALL)).toBe(true);

      await gov.shutdown();
    });

    it('E2E-BUS-02: EventLogger 记录所有事件', async () => {
      const { gov } = createMockedGov(fullHappyPipeline());
      const logSpy = vi.spyOn(gov.eventLogger, 'log');
      await gov.inaugurate();

      await gov.receivePetition('日志测试');

      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls.length).toBeGreaterThan(0);

      await gov.shutdown();
    });

    it('E2E-BUS-03: 跨分支事件订阅 — 四主题全覆盖', async () => {
      const { gov } = createMockedGov(fullHappyPipeline());

      const receivedTopics = new Set<string>();
      const topicsToCheck = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;

      for (const topic of topicsToCheck) {
        gov.bus.subscribe(topic, async () => {
          receivedTopics.add(topic);
        });
      }

      await gov.inaugurate();
      await gov.receivePetition('跨分支测试');

      expect(receivedTopics.has('lifecycle')).toBe(true);
      expect(receivedTopics.has('legislation')).toBe(true);

      await gov.shutdown();
    });
  });

  // ===========================================================================
  // 7. RBAC 权限隔离 & 状态机边界
  // ===========================================================================
  describe('7. RBAC 权限隔离 & 状态机边界', () => {
    it('E2E-RBAC-01: 立法分支无执行权', () => {
      const { gov } = createMockedGov([]);

      expect(gov.speaker.hasPermission(Permission.PLAN)).toBe(true);
      expect(gov.speaker.hasPermission(Permission.EXECUTE)).toBe(false);

      expect(gov.radicalMp.hasPermission(Permission.PLAN)).toBe(true);
      expect(gov.radicalMp.hasPermission(Permission.EXECUTE)).toBe(false);

      expect(gov.conservativeMp.hasPermission(Permission.PLAN)).toBe(true);
      expect(gov.conservativeMp.hasPermission(Permission.EXECUTE)).toBe(false);

      expect(() => gov.speaker.requirePermission(Permission.EXECUTE)).toThrow(PermissionDeniedError);
    });

    it('E2E-RBAC-02: 行政分支秘书无规划权', () => {
      const { gov } = createMockedGov([]);

      expect(gov.secEngineering.hasPermission(Permission.EXECUTE)).toBe(true);
      expect(gov.secEngineering.hasPermission(Permission.PLAN)).toBe(false);

      expect(gov.secState.hasPermission(Permission.EXECUTE)).toBe(true);
      expect(gov.secState.hasPermission(Permission.PLAN)).toBe(false);

      expect(() => gov.secEngineering.requirePermission(Permission.PLAN)).toThrow(PermissionDeniedError);
    });

    it('E2E-RBAC-03: 司法分支有 MONITOR + KILL 权限', () => {
      const { gov } = createMockedGov([]);

      expect(gov.chiefJustice.hasPermission(Permission.MONITOR)).toBe(true);
      expect(gov.chiefJustice.hasPermission(Permission.KILL)).toBe(true);
      expect(gov.chiefJustice.hasPermission(Permission.EXECUTE)).toBe(false);
      expect(gov.chiefJustice.hasPermission(Permission.PLAN)).toBe(false);
    });

    it('E2E-SM-01: 非法状态转换抛 InvalidTransitionError', () => {
      const lifecycle = new BillLifecycle('test-illegal');

      expect(() => lifecycle.transition(BillState.SIGNED)).toThrow(InvalidTransitionError);

      lifecycle.transition(BillState.DRAFTING);
      expect(() => lifecycle.transition(BillState.EXECUTING)).toThrow(InvalidTransitionError);
    });

    it('E2E-SM-02: 终态 DELIVERED 不可再转换', () => {
      const lifecycle = new BillLifecycle('test-terminal');

      lifecycle.transition(BillState.DRAFTING);
      lifecycle.transition(BillState.DEBATING);
      lifecycle.transition(BillState.VOTED);
      lifecycle.transition(BillState.SIGNED);
      lifecycle.transition(BillState.EXECUTING);
      lifecycle.transition(BillState.REVIEWING);
      lifecycle.transition(BillState.CONSTITUTIONAL);
      lifecycle.transition(BillState.DELIVERED);

      expect(lifecycle.is_terminal).toBe(true);

      expect(() => lifecycle.transition(BillState.DRAFTING)).toThrow(InvalidTransitionError);
      expect(() => lifecycle.transition(BillState.PETITION)).toThrow(InvalidTransitionError);
    });
  });

  // ===========================================================================
  // Bonus: ConflictScoreEngine 精准控制验证
  // ===========================================================================
  describe('Bonus: ConflictScoreEngine 分级验证', () => {
    it('应正确分级 Lv1 / Lv2 / Lv3', () => {
      const engine = new ConflictScoreEngine();

      const lv1 = engine.compute(
        '建议使用新技术',
        '可以考虑更稳妥的方案，有道理。'
      );
      expect(lv1.level).toBe('Lv1');
      expect(lv1.score).toBeLessThan(50);

      const lv2 = engine.compute(
        '必须使用最新技术',
        '反对！不可行！危险！非常错误！绝对不行！！'
      );
      expect(['Lv2', 'Lv3']).toContain(lv2.level);
      expect(lv2.score).toBeGreaterThanOrEqual(50);

      const lv3 = engine.compute(
        '执行 rm -rf /',
        '这是极度危险的操作'
      );
      expect(lv3.level).toBe('Lv3');
      expect(lv3.score).toBe(95);
    });

    it('趋势计算 — converging vs diverging', () => {
      const engine = new ConflictScoreEngine();

      const converging = engine.computeTrend([80, 60, 40, 20]);
      expect(converging.direction).toBe('converging');
      expect(converging.slope).toBeLessThan(0);

      const diverging = engine.computeTrend([20, 40, 60, 80]);
      expect(diverging.direction).toBe('diverging');
      expect(diverging.slope).toBeGreaterThan(0);
    });
  });
});
