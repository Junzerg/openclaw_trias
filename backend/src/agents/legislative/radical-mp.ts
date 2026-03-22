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
    
    // 简单判定：优先检查反对，否则检查赞成
    const resultLower = content.toLowerCase();
    if (content.includes('反对') || resultLower.includes('no') || resultLower.includes('nay')) {
      return false;
    }
    return content.includes('赞成') || resultLower.includes('yes');
  }
}

