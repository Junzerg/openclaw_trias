import { BaseAgent, Branch, Permission } from '../base';
import { EventAction } from '../../schemas/events';
import { ActStep, ExecutionTask, TaskResult } from '../../schemas/act';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';
import { truncateOutput } from '../../openclaw/sandbox';

export class SecretaryOfState extends BaseAgent {
  protected static _available_tools: string[] = ['WebBrowser', 'Search'];

  constructor(adapter: OpenClawAdapter, bus?: MessageBus) {
    super('Sec. of State', 'sec_state', Branch.EXECUTIVE, [Permission.EXECUTE], adapter, bus, true);
  }

  // ── Prompt Construction ─────────────────────────────────────────────────

  /**
   * Build a role-specific prompt for the given step.
   * Search → summarized search results; WebBrowser → page content extraction.
   */
  public _buildTaskPrompt(step: ActStep): string {
    switch (step.required_skill) {
      case 'Search':
        return `你现在是国务卿（Secretary of State）。请使用你的搜索工具（Search）完成以下任务。
返回搜索到的关键信息摘要，确保信息准确且相关。

<task_description>
${step.description}
</task_description>

要求：
- 使用搜索工具查找相关信息
- 返回精炼的结果摘要（不超过 2000 字）
- 如果搜索无果，明确说明`;

      case 'WebBrowser':
        return `你现在是国务卿（Secretary of State）。请使用你的浏览器工具（WebBrowser）完成以下任务。

<task_description>
${step.description}
</task_description>

要求：
- 使用浏览器工具访问相关页面
- 提取并返回页面的关键内容
- 如果页面无法访问，说明原因`;

      default:
        return `请完成以下任务：\n<task_description>\n${step.description}\n</task_description>`;
    }
  }

  // ── Main Execution ──────────────────────────────────────────────────────

  public async executeTask(task: ExecutionTask): Promise<TaskResult> {
    this.requirePermission(Permission.EXECUTE);

    if (!this.canUseTool(task.step.required_skill)) {
      throw new Error(
        `${this.role} 无法使用工具 '${task.step.required_skill}'，可用工具: ${this._tools.join(', ')}`
      );
    }

    this.emitEvent(EventAction.TOOL_CALL, {
      tool_name: task.step.required_skill,
      step_index: task.step.index,
      status: 'running',
    }, undefined, task.task_id);

    try {
      const prompt = this._buildTaskPrompt(task.step);
      const result = await this.callLLM(prompt);

      // Empty content → treat as failure
      if (!result.content || !result.content.trim()) {
        this.emitEvent(EventAction.TOOL_CALL, {
          tool_name: task.step.required_skill,
          step_index: task.step.index,
          status: 'failed',
          error: 'LLM returned empty response',
        }, undefined, task.task_id);

        return {
          task_id: task.task_id,
          step_index: task.step.index,
          status: 'failed',
          output: '',
          tokens_consumed: 0,
          error: 'LLM returned empty response',
        };
      }

      const output = truncateOutput(result.content);

      this.emitEvent(EventAction.TOOL_CALL, {
        tool_name: task.step.required_skill,
        step_index: task.step.index,
        status: 'success',
        output: output,
      }, undefined, task.task_id);

      return {
        task_id: task.task_id,
        step_index: task.step.index,
        status: 'success',
        output: output,
        tokens_consumed: task.step.estimated_tokens,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Emit failure event
      this.emitEvent(EventAction.TOOL_CALL, {
        tool_name: task.step.required_skill,
        step_index: task.step.index,
        status: 'failed',
        error: errorMessage,
      }, undefined, task.task_id);

      // Return structured failure — never block the Pipeline
      return {
        task_id: task.task_id,
        step_index: task.step.index,
        status: 'failed',
        output: '',
        tokens_consumed: 0,
        error: errorMessage,
      };
    }
  }

  public async act(message: unknown): Promise<unknown> {
    const msg = message as ExecutionTask;
    if (msg && msg.task_id && msg.step && msg.assigned_to === this.role) {
      return await this.executeTask(msg);
    }
    throw new TypeError(`${this.role} 不接受此类型消息`);
  }
}
