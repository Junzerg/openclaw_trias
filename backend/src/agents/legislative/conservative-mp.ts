import { BaseAgent, Branch, Permission } from '../base';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

import { VoteOutcome } from './debate';

export class ConservativeMP extends BaseAgent {
  constructor(adapter: OpenClawAdapter, bus?: MessageBus, loadSoulFlag: boolean = true) {
    super('Conservative MP', 'conservative_mp', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, loadSoulFlag);
  }

  async act(_message: unknown): Promise<unknown> {
    this.requirePermission(Permission.PLAN);
    return null;
  }

  async critique(proposal: string, _taskId?: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请对以下提案进行安全性和稳定性审查：\n\n如果提案非常完美没有任何安全隐患，你认为无需补充也不要发表废话，你必须且只能在回复的最开头输出 \`[CONSENSUS_REACHED]\` 字样。\n\n<proposal>\n${proposal}\n</proposal>`;
    const result = await this.callLLM(prompt, _taskId);
    return result.content;
  }

  async rebut(counterArgument: string, _taskId?: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请针对以下反驳进行二次论证：\n\n如果对方的反驳已经彻底消除了你的安全顾虑，让你觉得再无必要抬杠，或者是你也打算退让达成共识了，你必须且只能在回复的最开头输出 \`[CONSENSUS_REACHED]\` 字样，可以附带几句总结意见。\n\n<radical_rebuttal>\n${counterArgument}\n</radical_rebuttal>`;
    const result = await this.callLLM(prompt, _taskId);
    return result.content;
  }

  async vote(proposal: string, _taskId?: string): Promise<VoteOutcome> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请对以下提案投票（赞成/反对）。无论之前是否已达成共识，你必须且只能明确回复包含“赞成”或“反对”字样：\n\n<proposal>\n${proposal}\n</proposal>`;
    const result = await this.callLLM(prompt, _taskId);
    const content = result.content;
    
    const resultLower = content.toLowerCase();
    // Bug 18 fix: 使用更精确的投票解析
    const cleanedForNay = resultLower
      .replace(/\bno\s+(problem|issue|doubt|question|objection)s?\b/gi, '')
      .replace(/\bnot\s+a\s+problem\b/gi, '');
      
    const isNay = content.includes('反对') || /\bno\b/.test(cleanedForNay) || /\bnay\b/.test(cleanedForNay);
    if (isNay && !content.includes('[CONSENSUS_REACHED]')) return { voteValue: false, reason: content };
    
    const voteValue = content.includes('赞成') || content.includes('同意') || content.includes('支持')
      || content.includes('[CONSENSUS_REACHED]')
      || /\byes\b/.test(resultLower) || /\baye\b/.test(resultLower)
      || /\bsupport\b/.test(resultLower) || /\bagree\b/.test(resultLower)
      || /\bapprove\b/.test(resultLower);
      
    return { voteValue: voteValue || false, reason: content };
  }
}

