import { randomUUID } from 'node:crypto';
import { BaseAgent, Branch, Permission } from '../base';
import type { OpenClawAdapter } from '../../openclaw/adapter';
import type { MessageBus } from '../../bus/message-bus';

import type { RadicalMP } from './radical-mp';
import type { ConservativeMP } from './conservative-mp';
import { DebateEngine, VotingMachine, DebateConfig, DebateResult, VoteResult, Voter } from './debate';

import { Act, ActStep, DebateRecord, ActVoteRecord } from '../../schemas/act';

export class Speaker extends BaseAgent {
  private _currentPetition: string | null = null;

  constructor(adapter: OpenClawAdapter, bus?: MessageBus, loadSoulFlag: boolean = true) {
    super('Speaker', 'speaker', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, loadSoulFlag);
  }

  async act(_message: unknown): Promise<unknown> {
    this.requirePermission(Permission.PLAN);
    // 当前阶段仅做权限校验，完整的消息分发逻辑在 Task 1-F 实现
    return null;
  }

  async receivePetition(petition: string): Promise<void> {
    this.requirePermission(Permission.PLAN);
    this._currentPetition = petition;
  }

  /**
   * 控场：管理辩论轮次、判定终止条件。
   */
  async moderateDebate(
    radical: RadicalMP,
    conservative: ConservativeMP,
    config: DebateConfig,
    taskId: string
  ): Promise<DebateResult> {
    this.requirePermission(Permission.PLAN);

    if (!this._currentPetition) {
      throw new Error('尚未接收选民请愿，无法启动辩论');
    }

    const engine = new DebateEngine(config);
    return await engine.runDebate(
      this,
      radical,
      conservative,
      this._currentPetition,
      taskId
    );
  }

  /**
   * 发起表决。
   */
  async callVote(proposal: string, voters: Voter[]): Promise<VoteResult> {
    this.requirePermission(Permission.PLAN);
    const machine = new VotingMachine();
    return await machine.tally(proposal, voters);
  }

  /**
   * 议长控场介入 — 在分歧度过高时发出冷静声明。
   */
  async intervene(proposal: string, critique: string, conflictScore: number): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为议长，当前辩论分歧度达到 ${conflictScore.toFixed(1)}，已超过控场阈值。请发出冷静声明，引导双方理性讨论。\n\n提案摘要：${proposal.substring(0, 200)}\n批评摘要：${critique.substring(0, 200)}`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  /**
   * 生成《执行法案》— 辩论结束 + 表决通过后生成结构化法案。
   */
  async generateAct(petition: string, debateResult: DebateResult, voteResult: VoteResult): Promise<Act> {
    this.requirePermission(Permission.PLAN);

    if (!voteResult.passed) {
      throw new Error('表决未通过，无法生成执行法案');
    }

    // 从辩论结果提取共识点（使用 LLM 将自然语言提炼为执行步骤）
    const prompt = `将以下辩论共识提炼为具体且可执行的独立步骤指令（仅包含自然语言正文）：\n\n${debateResult.final_proposal}`;
    const result = await this.callLLM(prompt);

    const step: ActStep = {
      index: 0,
      description: result.content, // [优化] 使用大模型提炼过后的内容作为行动指南
      required_skill: 'CodeExecution',
      tool_parameters: {},
      estimated_tokens: 10000,
      acceptance_criteria: '按照提案内容完成执行',
      dependencies: []
    };

    const debateRecord: DebateRecord = {
      total_rounds: debateResult.rounds.length,
      final_conflict_score: debateResult.final_conflict_score,
      consensus_points: [debateResult.final_proposal],
      remaining_concerns: []
    };

    const voterPositions: Record<string, string> = {};
    for (const record of voteResult.records) {
      voterPositions[record.voter_role] = record.vote ? 'aye' : 'nay';
    }

    const actVoteRecord: ActVoteRecord = {
      ayes: voteResult.ayes,
      nays: voteResult.nays,
      result: voteResult.passed ? 'passed' : 'rejected',
      voter_positions: voterPositions
    };

    return {
      act_id: randomUUID(),
      title: `法案：${petition.substring(0, 50)}`,
      summary: debateResult.final_proposal.substring(0, 200),
      petition_origin: petition,
      steps: [step],
      total_estimated_tokens: step.estimated_tokens,
      debate_record: debateRecord,
      vote_record: actVoteRecord,
      created_at: new Date()
    };
  }
}
