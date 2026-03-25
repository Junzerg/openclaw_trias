import { BaseAgent, Branch, Permission } from '../base';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

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
    const prompt = `作为激进派议员，请针对以下选民请愿提出前沿技术方案：\n\n${petition}`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async rebut(critique: string): Promise<string> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为激进派议员，请反驳以下保守派的批评：\n\n${critique}`;
    const result = await this.callLLM(prompt);
    return result.content;
  }

  async vote(proposal: string): Promise<boolean> {
    this.requirePermission(Permission.PLAN);
    const prompt = `作为激进派议员，请对以下提案投票（赞成/反对）：\n\n${proposal}`;
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
    if (isNay) return false;
    // 3. 检测赞成（扩展关键词）
    return content.includes('赞成') || content.includes('同意') || content.includes('支持')
      || /\byes\b/.test(resultLower) || /\baye\b/.test(resultLower)
      || /\bsupport\b/.test(resultLower) || /\bagree\b/.test(resultLower)
      || /\bapprove\b/.test(resultLower);
  }
}

