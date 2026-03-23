import { BaseAgent, Branch, Permission } from '../base';
import { EventAction } from '../../schemas/events';
import { Act, VetoNotice, ExecutionTask } from '../../schemas/act';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';
import { randomUUID } from 'node:crypto';

const DEFAULT_SKILL_TO_ROLE: Record<string, string> = {
  CodeExecution: 'sec_engineering',
  Python_Interpreter: 'sec_engineering',
  GitHub: 'sec_engineering',
  WebBrowser: 'sec_state',
  Search: 'sec_state',
};

export class President extends BaseAgent {
  private _tokenBudget: number;
  private _skillToRole: Record<string, string>;
  private _availableSkills: Set<string>;

  constructor(
    adapter: OpenClawAdapter,
    bus?: MessageBus,
    tokenBudget: number = 50000,
    availableSkills?: Set<string>,
    skillToRole?: Record<string, string>
  ) {
    super('President', 'president', Branch.EXECUTIVE, [Permission.PLAN, Permission.VETO], adapter, bus, true);
    this._tokenBudget = tokenBudget;
    this._skillToRole = skillToRole || { ...DEFAULT_SKILL_TO_ROLE };
    this._availableSkills = availableSkills || new Set(Object.keys(this._skillToRole));
  }

  public async evaluateAct(act: Act): Promise<VetoNotice | null> {
    this.requirePermission(Permission.PLAN);

    const issues: string[] = [];

    // 1) Token Budget Check
    if (act.total_estimated_tokens > this._tokenBudget) {
      issues.push(`法案预估 Token (${act.total_estimated_tokens}) 超出行政预算 (${this._tokenBudget})`);
    }

    // 2) Skill Availability Check
    for (const step of act.steps) {
      if (!this._availableSkills.has(step.required_skill)) {
        issues.push(`步骤 ${step.index} 所需 Skill '${step.required_skill}' 不可用`);
      }
    }
    
    // 3) LLM Evaluation for Veto
    if (issues.length === 0) {
      const prompt = `
请作为总统审查以下法案，决定是否必须行使否决权 (VETO)。
如果法案存在严重违规、逻辑荒谬或对系统有严重破坏性，请否决。
否则请通过。
法案内容:
标题: ${act.title}
摘要: ${act.summary}
步骤数: ${act.steps.length}

请直接回复：[SIGN] 或者 [VETO: 理由]
      `.trim();

      const response = await this.callLLM(prompt);
      const content = response.content.trim();
      
      if (content.startsWith('[VETO')) {
        const reasonStr = content.replace(/^\[VETO[:：]?\s*/i, '').replace(/\]$/, '').trim();
        issues.push(`LLM 裁定否决: ${reasonStr}`);
      }
    }

    if (issues.length === 0) {
      // SIGN
      this.emitEvent(EventAction.SIGN_ACT, { act_id: act.act_id }, undefined, act.act_id);
      return null;
    }

    // VETO
    this.requirePermission(Permission.VETO);
    const vetoNotice: VetoNotice = {
      act_id: act.act_id,
      reason: '法案审查未通过，存在以下问题',
      specific_issues: issues,
      suggestion: '请修改法案后重新提交',
    };
    
    this.emitEvent(EventAction.VETO, { reason: vetoNotice.reason, veto_notice: vetoNotice }, undefined, act.act_id);
    return vetoNotice;
  }

  public dispatchTasks(act: Act): ExecutionTask[] {
    this.requirePermission(Permission.PLAN);
    const tasks: ExecutionTask[] = [];
    for (const step of act.steps) {
      const role = this._skillToRole[step.required_skill] || 'unknown';
      tasks.push({
        task_id: randomUUID(),
        act_id: act.act_id,
        step: step,
        assigned_to: role,
      });
    }
    return tasks;
  }

  public async act(message: unknown): Promise<unknown> {
    const msg = message as any;
    if (msg && msg.act_id && Array.isArray(msg.steps)) {
      return await this.evaluateAct(msg as Act);
    }
    throw new TypeError('President 不接受此类型消息');
  }
}
