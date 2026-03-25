import { BaseAgent, Branch, Permission } from '../base';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

export class ConservativeMP extends BaseAgent {
  constructor(adapter: OpenClawAdapter, bus?: MessageBus, loadSoulFlag: boolean = true) {
    super('Conservative MP', 'conservative_mp', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, loadSoulFlag);
  }

  async act(_message: unknown): Promise<unknown> {
    this.requirePermission(Permission.PLAN);
    return null;
  }

  async critique(proposal: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请对以下提案进行安全性和稳定性审查：\n\n${proposal}`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async rebut(counterArgument: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请针对以下反驳进行二次论证：\n\n${counterArgument}`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async vote(proposal: string): Promise<boolean> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为保守派议员，请对以下提案投票（赞成/反对）：\n\n${proposal}`;
    const result = await this.callLLM(prompt);
    const content = result.content;
    
    const resultLower = content.toLowerCase();
    // Bug 18 fix: 使用更精确的投票解析
    const cleanedForNay = resultLower
      .replace(/\bno\s+(problem|issue|doubt|question|objection)s?\b/gi, '')
      .replace(/\bnot\s+a\s+problem\b/gi, '');
    const isNay = content.includes('反对') || /\bno\b/.test(cleanedForNay) || /\bnay\b/.test(cleanedForNay);
    if (isNay) return false;
    return content.includes('赞成') || content.includes('同意') || content.includes('支持')
      || /\byes\b/.test(resultLower) || /\baye\b/.test(resultLower)
      || /\bsupport\b/.test(resultLower) || /\bagree\b/.test(resultLower)
      || /\bapprove\b/.test(resultLower);
  }
}

