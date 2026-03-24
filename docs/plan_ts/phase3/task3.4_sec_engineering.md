# Task 3.4: SecEngineering 真实代码执行

> **目标**：将 `SecretaryOfEngineering` 从 Mock 切换为 **真实调用 OpenClaw CodeExecution Skill**，实现"AI 写代码并执行"的核心能力。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md) + [Task 3.2](task3.2_error_retry.md)
> **对应目录**：`backend/src/agents/executive/`
> **预估耗时**：0.5-1 会话

## 需求说明

### 1. 两阶段执行设计

当前的 `executeTask()` 返回 `[Mock]` 硬编码文本（`sec-engineering.ts:31`）。重构为两阶段真实执行：

```
阶段 1: 代码生成 (callLLM)
  Input:  step.description ("用 Python 编写 hello world")
  Prompt: 要求 LLM 返回 { language, code } JSON
  Output: { language: "python", code: "print('hello world')" }

阶段 2: 代码执行 (adapter.executeCode)
  Input:  code + language
  Output: ExecResult { stdout, stderr, exitCode }

映射: ExecResult → TaskResult
  exitCode == 0 → status: 'success', output: stdout
  exitCode != 0 → status: 'failed', error: stderr
```

### 2. 代码生成 Prompt

```typescript
private async _generateCode(description: string): Promise<{ language: string; code: string }> {
  const prompt = `你是一个精确的代码生成器。根据以下任务描述，生成可直接执行的代码。

任务描述：
"""
${description}
"""

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

  const result = await this.callLLM(prompt);
  return this._extractCodeFromLLM(result.content);
}
```

### 3. JSON 提取与 Fallback

```typescript
private _extractCodeFromLLM(content: string): { language: string; code: string } {
  // 尝试提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.code) {
      const lang = ['python', 'javascript', 'bash'].includes(parsed.language)
        ? parsed.language : 'python';
      return { language: lang, code: parsed.code };
    }
  }
  // Fallback: 将整个输出当作 Python 代码
  return { language: 'python', code: content };
}
```

### 4. `executeTask()` 重构

```typescript
public async executeTask(task: ExecutionTask): Promise<TaskResult> {
  this.requirePermission(Permission.EXECUTE);
  // 省略工具校验（已有）...

  this.emitEvent(EventAction.TOOL_CALL, {
    tool_name: task.step.required_skill,
    step_index: task.step.index,
    status: 'running',
  }, undefined, task.task_id);

  try {
    // 阶段 1: 代码生成
    const { language, code } = await this._generateCode(task.step.description);

    // 阶段 2: 代码执行
    const execResult = await this.adapter.executeCode(code, language);

    const success = execResult.exitCode === 0;
    this.emitEvent(EventAction.TOOL_CALL, {
      tool_name: task.step.required_skill,
      step_index: task.step.index,
      status: success ? 'success' : 'failed',
    }, undefined, task.task_id);

    return {
      task_id: task.task_id,
      step_index: task.step.index,
      status: success ? 'success' : 'failed',
      output: execResult.stdout || execResult.stderr,
      error: success ? undefined : execResult.stderr,
      tokens_consumed: task.step.estimated_tokens,
    };
  } catch (err: any) {
    // ... 错误处理（emit failed + 返回 failed TaskResult）
  }
}
```

### 5. Fallback 策略

| 场景 | 处理 |
|------|------|
| 代码生成 JSON 解析失败 | `withRetry` 重试 1 次（Task 3.2 基础设施）；最终 fallback 整个输出当 Python 代码 |
| 语言不在白名单 | Fallback 到 `python` |
| 代码执行超时 (>60s) | 返回 `failed` + `timeout` 错误信息 |
| exitCode ≠ 0 | 返回 `failed` + stderr 作为错误信息 |
| 两阶段全失败 | 返回结构化 `TaskResult`，不阻塞 Pipeline |

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `agents/executive/sec-engineering.ts` | ~120 (重构) | Mock → 两阶段真实执行 |
| `tests/agents/executive/sec-engineering.test.ts` | ~150 (更新) | Mock adapter 验证两阶段调用链 |

## 验收维度

- [x] 简单请愿 "写 hello world" → SecEngineering 真实生成 + 执行 → stdout 包含 "hello"
- [x] 执行结果正确映射为 `TaskResult.output`（成功→stdout，失败→stderr 优先 fallback stdout）
- [x] 执行失败（如除零错误）→ `TaskResult.status = 'failed'` + 有意义的 `error`
- [x] LLM 返回畸形 JSON → 自动重试 1 次 → 仍失败则 fallback 为 Python 代码执行
- [x] Mock adapter 单测：验证调用链 `callLLM → extractCode → executeCode`
- [x] 所有现有测试通过（回归）
- [x] `npm run build` 零 TypeScript 报错

## 完成记录

- **完成日期**：2026-03-24
- **实际交付**：
  - `sec-engineering.ts`：170 行（重构，含两阶段执行 + 重试 + JSON 提取 + fallback）
  - `tests/sec-engineering.test.ts`：428 行（新增 23 个测试）
  - `tests/executive.test.ts`：328 行（更新 mock 桩以支持两阶段流）
- **测试总数**：375（原 352 + 新增 23）
- **审查轮次**：3 轮深度审查，修复 5 个 Bug：
  - Bug #1 (High): 缺少 withRetry JSON 解析重试（验收项 #4）
  - Bug #2 (Low): 贪婪正则边界风险（已加测试覆盖）
  - Bug #3 (Medium): `output` 失败时应优先展示 stderr
  - Bug #4 (Low): `_isValidExtraction` 与 `_extractCodeFromLLM` 逻辑重复
  - Bug #5 (Low): 重构时丢失 `_generateCode` 闭合花括号
