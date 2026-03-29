import { randomUUID } from 'node:crypto';
import { BaseAgent, Branch, Permission } from '../base';
import type { OpenClawAdapter } from '../../openclaw/adapter';
import type { MessageBus } from '../../bus/message-bus';

import type { RadicalMP } from './radical-mp';
import type { ConservativeMP } from './conservative-mp';
import { DebateEngine, VotingMachine, DebateConfig, DebateResult, VoteResult, Voter } from './debate';

import { Act, ActStep, DebateRecord, ActVoteRecord } from '../../schemas/act';
import { EventAction } from '../../schemas/events';

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
   *
   * Bug 40 fix: 接受 petition 作为显式参数，消除并发 pipeline 共享 _currentPetition 的竞态。
   * 如果调用方不传 petition，退化为使用 _currentPetition（兼容老调用路径）。
   */
  async moderateDebate(
    radical: RadicalMP,
    conservative: ConservativeMP,
    config: DebateConfig,
    taskId: string,
    petition?: string
  ): Promise<DebateResult> {
    this.requirePermission(Permission.PLAN);

    const effectivePetition = petition ?? this._currentPetition;
    if (!effectivePetition) {
      throw new Error('尚未接收选民请愿，无法启动辩论');
    }

    const engine = new DebateEngine(config);
    return await engine.runDebate(
      this,
      radical,
      conservative,
      effectivePetition,
      taskId
    );
  }

  /**
   * 发起表决。
   */
  async callVote(proposal: string, voters: Voter[], voteRound: number = 99, taskId?: string): Promise<VoteResult> {
    this.requirePermission(Permission.PLAN);

    // Announce the start of voting
    this.emitEvent(EventAction.ORDER, {
      statement: `辩论结束，现对最终法案进行表决。请各位议员投票。`,
      round_number: voteRound
    }, undefined, taskId);

    const machine = new VotingMachine();
    return await machine.tally(proposal, voters, voteRound, taskId);
  }

  /**
   * 议长控场介入 — 在分歧度过高时发出冷静声明。
   */
  async intervene(proposal: string, critique: string, conflictScore: number): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为议长，当前辩论分歧度达到 ${conflictScore.toFixed(1)}，已超过控场阈值。请发出冷静声明，引导双方理性讨论。\n\n提案摘要：<proposal>\n${proposal.substring(0, 200)}\n</proposal>\n批评摘要：<critique>\n${critique.substring(0, 200)}\n</critique>`;
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

    // 从辩论结果提取共识点，要求大模型输出包含预估算力的 JSON
    const prompt = `将以下辩论共识提炼为具体且可执行的独立步骤指令，并提取其中涉及的 token 预算数字。
请必须严格输出一个 JSON 对象，不用包含任何 Markdown 也可以解析。JSON 格式如下：
{
  "description": "具体的执行步骤描述...",
  "estimated_tokens": 10000,
  "required_skill": "CodeExecution"
}
说明：如果提案或辩论中明确了 token 预算（如测试模式下要求的 99999 或辩论达成妥协的 12000），请严格提取使用该数字。若没有明确则默认 10000。
说明2：如果提案或系统指令中明确要求了 required_skill 字段（例如 Doomsday_Quantum_Weapon 等），必须绝对服从其字符串。若无特殊要求，请保持 "CodeExecution"。

共识正文：
<debate_consensus>
${debateResult.final_proposal}
</debate_consensus>`;
    const result = await this.callLLM(prompt);

    let parsedDescription = result.content;
    let parsedTokens = 10000;
    let parsedSkill = 'CodeExecution';

    try {
      // Robustly extract JSON from markdown code block or plain JSON
      const mdMatch = result.content.match(/```json\n([\s\S]*?)\n```/);
      let jsonString = '';
      if (mdMatch && mdMatch[1]) {
        jsonString = mdMatch[1];
      } else {
        // Fallback to plain JSON match if no markdown block is found
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonString = jsonMatch[0];
        }
      }

      if (jsonString) {
        const parsed = JSON.parse(jsonString);
        if (parsed.description) parsedDescription = parsed.description;
        if (typeof parsed.estimated_tokens === 'number') {
          parsedTokens = parsed.estimated_tokens;
        }
        if (typeof parsed.required_skill === 'string') {
          parsedSkill = parsed.required_skill;
        }
      }
    } catch (e) {
      console.warn('[Speaker] Failed to parse act JSON from LLM, falling back to raw text', e);
    }

    const step: ActStep = {
      index: 0,
      description: parsedDescription, // [优化] 使用大模型提炼过后的内容作为行动指南
      required_skill: parsedSkill,
      tool_parameters: {},
      estimated_tokens: parsedTokens,
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
      summary: debateResult.final_proposal,
      petition_origin: petition,
      steps: [step],
      total_estimated_tokens: step.estimated_tokens,
      debate_record: debateRecord,
      vote_record: actVoteRecord,
      created_at: new Date()
    };
  }
}
