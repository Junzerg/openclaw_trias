import { BaseAgent, Branch, Permission } from '../base';
import { EventAction } from '../../schemas/events';
import { ExecutionTask, TaskResult } from '../../schemas/act';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';
import { validateCode, truncateOutput } from '../../openclaw/sandbox';

/** Supported languages for code execution. */
const SUPPORTED_LANGUAGES = ['python', 'javascript', 'bash'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class SecretaryOfEngineering extends BaseAgent {
  protected static _available_tools: string[] = ['CodeExecution', 'Python_Interpreter', 'GitHub'];

  constructor(adapter: OpenClawAdapter, bus?: MessageBus) {
    super('Sec. of Engineering', 'sec_engineering', Branch.EXECUTIVE, [Permission.EXECUTE], adapter, bus, true);
  }

  // ── Phase 1: Code Generation ──────────────────────────────────────────────

  /**
   * Ask the LLM to generate executable code for the given task description.
   * Returns `{ language, code }` — either parsed from the LLM JSON response
   * or via the fallback strategy.
   */
  private async _generateCode(description: string, _taskId?: string): Promise<{ language: string; code: string }> {
    const prompt = `你是一个精确的代码生成器。根据以下任务描述，生成可直接执行的代码。

任务描述：
<task_description>
${description}
</task_description>

你必须返回一段合法 JSON（不要包含 Markdown 格式包裹）：
{
  "language": "python" | "javascript" | "bash",
  "code": "<完整可执行代码>"
}

规则：
1. 代码必须完整可执行（无 import 缺失、无语法错误）
2. 默认使用 Python，除非任务明确要求其他语言
3. 代码应在 30 秒内完成执行
4. 不要使用需要用户交互的代码（如 input()）`;

    // Use standard LLM call (streaming disabled deliberately)
    const result = await this.callLLM(prompt, _taskId);
    const extracted = this._extractCodeFromLLM(result.content);

    // If we got a valid JSON extraction (not a fallback), return immediately
    if (extracted.valid) {
      return extracted;
    }

    // Retry once: the first response wasn't valid JSON — ask LLM again
    console.log(`[SecEngineering] Code generation JSON parse failed, retrying once...`);
    try {
      const retryResult = await this.callLLM(prompt, _taskId);
      const retryExtracted = this._extractCodeFromLLM(retryResult.content);
      if (retryExtracted.valid) {
        return retryExtracted;
      }
    } catch {
      // Retry failed — fall through to use the original fallback
    }

    // Final fallback: use the original extraction (which is fallback to Python)
    console.log(`[SecEngineering] Retry also failed, using fallback (entire output as Python code)`);
    return extracted;
  }

  // ── JSON Extraction & Fallback ────────────────────────────────────────────

  /**
   * Extract `{ language, code }` from the LLM response text.
   *
   * Strategy:
   * 1. Try to find a JSON object via regex and parse it.
   * 2. Validate `code` field exists and `language` is in the whitelist.
   * 3. If anything fails, fallback: treat the entire output as Python code.
   */
  public _extractCodeFromLLM(content: string): { language: string; code: string; valid: boolean } {
    // 1. Try markdown json block
    const mdMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (mdMatch) {
      try {
        const parsed = JSON.parse(mdMatch[1]);
        if (parsed.code) {
          const lang: SupportedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(parsed.language)
            ? (parsed.language as SupportedLanguage)
            : 'python';
          return { language: lang, code: parsed.code, valid: true };
        }
      } catch {
        // Fall through
      }
    }

    // 2. Try counting brackets from the first '{' (Bug 57 fix: not greedy regex)
    const startIdx = content.indexOf('{');
    if (startIdx !== -1) {
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
      
      if (endIdx !== -1) {
        try {
          const parsed = JSON.parse(content.substring(startIdx, endIdx + 1));
          if (parsed.code) {
            const lang: SupportedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(parsed.language)
              ? (parsed.language as SupportedLanguage)
              : 'python';
            return { language: lang, code: parsed.code, valid: true };
          }
        } catch {
          // Fall through
        }
      }
    }

    // Fallback: treat the entire LLM output as Python code
    return { language: 'python', code: content, valid: false };
  }

  // ── Main Execution ────────────────────────────────────────────────────────

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
    }, undefined, task.act_id);

    try {
      // Phase 1: Code Generation
      const { language, code } = await this._generateCode(task.step.description, task.act_id);

      // Phase 1.5: Security Pre-check (Task 3.6)
      const validation = validateCode(code, language);
      if (!validation.valid) {
        this.emitEvent(EventAction.TOOL_CALL, {
          tool_name: task.step.required_skill,
          step_index: task.step.index,
          status: 'failed',
          error: `安全检查未通过: ${validation.reason}`,
        }, undefined, task.act_id);

        return {
          task_id: task.task_id,
          step_index: task.step.index,
          status: 'failed',
          output: '',
          error: `安全检查未通过: ${validation.reason}`,
          tokens_consumed: 0,
        };
      }

      // Phase 2: Code Execution
      const execResult = await this.adapter.executeCode(code, language, this.modelRef);

      const success = execResult.exitCode === 0;

      // Phase 3: Output Truncation (Task 3.6)
      const rawStdout = execResult.stdout || '';
      const rawStderr = execResult.stderr || '';
      const finalOutputBuffer = `[Generated ${language} Code]:\n${code}\n\n[Execution Output]:\n${success ? rawStdout : (rawStderr || rawStdout || 'No output')}`;
      const finalOutput = truncateOutput(finalOutputBuffer);
      const executionError = success ? undefined : (rawStderr || rawStdout || 'Unknown execution error');

      this.emitEvent(EventAction.TOOL_CALL, {
        tool_name: task.step.required_skill,
        step_index: task.step.index,
        status: success ? 'success' : 'failed',
        output: finalOutput,
        error: executionError,
      }, undefined, task.act_id);

      return {
        task_id: task.task_id,
        step_index: task.step.index,
        status: success ? 'success' : 'failed',
        output: finalOutput,
        error: executionError,
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
      }, undefined, task.act_id);

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
