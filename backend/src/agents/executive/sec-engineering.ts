import { BaseAgent, Branch, Permission } from '../base';
import { EventAction } from '../../schemas/events';
import { ExecutionTask, TaskResult } from '../../schemas/act';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

export class SecretaryOfEngineering extends BaseAgent {
  protected static _available_tools: string[] = ['CodeExecution', 'Python_Interpreter', 'GitHub'];

  constructor(adapter: OpenClawAdapter, bus?: MessageBus) {
    super('Sec. of Engineering', 'sec_engineering', Branch.EXECUTIVE, [Permission.EXECUTE], adapter, bus, true);
  }

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
      // Mock execution - placeholder for Phase 2 adapter.executeCode()
      const output = `[Mock] ${this.role} 完成步骤 ${task.step.index}: ${task.step.description}`;
      // emit success
      this.emitEvent(EventAction.TOOL_CALL, {
        tool_name: task.step.required_skill,
        step_index: task.step.index,
        status: 'success',
      }, undefined, task.task_id);

      return {
        task_id: task.task_id,
        step_index: task.step.index,
        status: 'success',
        output: output,
        tokens_consumed: task.step.estimated_tokens,
      };
    } catch (err: any) {
      // emit failure
      this.emitEvent(EventAction.TOOL_CALL, {
        tool_name: task.step.required_skill,
        step_index: task.step.index,
        status: 'failed',
        error: err.message || String(err),
      }, undefined, task.task_id);

      return {
        task_id: task.task_id,
        step_index: task.step.index,
        status: 'failed',
        output: '',
        tokens_consumed: 0,
        error: err.message || String(err),
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
