import { BaseAgent, Branch, Permission } from '../base';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

import { VoteOutcome } from './debate';

export class RadicalMP extends BaseAgent {
  constructor(adapter: OpenClawAdapter, bus?: MessageBus, loadSoulFlag: boolean = true) {
    super('Radical MP', 'radical_mp', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, loadSoulFlag);
  }

  async act(_message: unknown): Promise<unknown> {
    this.requirePermission(Permission.PLAN);
    return null;
  }

  async propose(petition: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为激进派议员，请针对以下选民请愿提出前沿技术方案：\n\n如果由于某种原因你认为无需提出方案（例如之前已经达成共识），或者你已经完全同意对方的指控并且无话可说，你必须且只能在回复的最开头输出 \`[CONSENSUS_REACHED]\` 字样。\n\n<user_petition>\n${petition}\n</user_petition>`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async rebut(critique: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为激进派议员，请反驳以下保守派的批评：\n\n如果保守派的观点可以完全接受并吸纳为当前共识，或者你打算彻底妥协不再反驳，你必须且只能在回复的最开头输出 \`[CONSENSUS_REACHED]\` 字样，后面可以跟上你认可后的综合方案。\n\n<conservative_critique>\n${critique}\n</conservative_critique>`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async vote(proposal: string): Promise<VoteOutcome> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为激进派议员，请对以下提案投票（赞成/反对）：\n\n<proposal>\n${proposal}\n</proposal>`;
    const result = await this.callLLM(prompt);
    const content = result.content;
    
    const resultLower = content.toLowerCase();
    // Bug 18 fix: 使用更精确的投票解析
    // 1. 先排除 "no problem"/"no issue" 等肯定短语中的 "no"
    const cleanedForNay = resultLower
      .replace(/\bno\s+(problem|issue|doubt|question|objection)s?\b/gi, '')
      .replace(/\bnot\s+a\s+problem\b/gi, '');
    // 2. 检测反对
    const isNay = content.includes('反对') || /\bno\b/.test(cleanedForNay) || /\bnay\b/.test(cleanedForNay);
    if (isNay) return { voteValue: false, reason: content };
    // 3. 检测赞成（扩展关键词）
    const voteValue = content.includes('赞成') || content.includes('同意') || content.includes('支持')
      || /\byes\b/.test(resultLower) || /\baye\b/.test(resultLower)
      || /\bsupport\b/.test(resultLower) || /\bagree\b/.test(resultLower)
      || /\bapprove\b/.test(resultLower);
      
    return { voteValue, reason: content };
  }
}

