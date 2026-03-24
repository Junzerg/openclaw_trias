# Task 3.5: SecState 搜索与浏览对接

> **目标**：将 `SecretaryOfState` 从 Mock 切换为真实调用 OpenClaw 的 Search/WebBrowser Skill。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md) + [Task 3.2](task3.2_error_retry.md)
> **对应目录**：`backend/src/agents/executive/`
> **预估耗时**：0.5 会话

## 需求说明

### 设计差异：为什么与 SecEngineering 不同？

SecEngineering 采用 **两阶段执行**（LLM 生成代码 → `adapter.executeCode` 执行），而 SecState 采用 **单阶段 LLM 委托**模式：

| 对比 | SecEngineering | SecState |
|------|---------------|---------|
| Skill 类型 | 代码执行（确定性输入输出） | 搜索/浏览（需要 Agent 自行决策） |
| 调用链 | `callLLM(生成代码) → executeCode(执行)` | `callLLM(含工具指令) → Agent 自行使用 Skill` |
| 结果格式 | `stdout/stderr/exitCode` | 自然语言文本 |

> **设计理由**：Search 和 WebBrowser 是 OpenClaw Agent 的内置工具，Agent 比编排层更了解何时搜索、何时浏览、搜索什么关键词。直接用自然语言委托比手工构造 Skill 调用更简洁可靠。

### 1. `executeTask()` 重构

```typescript
public async executeTask(task: ExecutionTask): Promise<TaskResult> {
  this.requirePermission(Permission.EXECUTE);
  // 工具校验（已有）...

  this.emitEvent(EventAction.TOOL_CALL, {
    tool_name: task.step.required_skill,
    step_index: task.step.index,
    status: 'running',
  }, undefined, task.task_id);

  try {
    const prompt = this._buildTaskPrompt(task.step);
    const result = await this.callLLM(prompt);

    this.emitEvent(EventAction.TOOL_CALL, {
      tool_name: task.step.required_skill,
      step_index: task.step.index,
      status: 'success',
    }, undefined, task.task_id);

    return {
      task_id: task.task_id,
      step_index: task.step.index,
      status: 'success',
      output: result.content,
      tokens_consumed: task.step.estimated_tokens,
    };
  } catch (err: any) {
    // ... 错误处理
  }
}
```

### 2. Prompt 构造

```typescript
private _buildTaskPrompt(step: ActStep): string {
  switch (step.required_skill) {
    case 'Search':
      return `你现在是国务卿（Secretary of State）。请使用你的搜索工具（Search）完成以下任务。
返回搜索到的关键信息摘要，确保信息准确且相关。

任务：${step.description}

要求：
- 使用搜索工具查找相关信息
- 返回精炼的结果摘要（不超过 2000 字）
- 如果搜索无果，明确说明`;

    case 'WebBrowser':
      return `你现在是国务卿（Secretary of State）。请使用你的浏览器工具（WebBrowser）完成以下任务。

任务：${step.description}

要求：
- 使用浏览器工具访问相关页面
- 提取并返回页面的关键内容
- 如果页面无法访问，说明原因`;

    default:
      return `请完成以下任务：${step.description}`;
  }
}
```

### 3. 结果映射

| LLM 返回 | TaskResult |
|----------|-----------|
| `content` 非空 | `status: 'success'`, `output: content` |
| `content` 空 | `status: 'failed'`, `error: 'LLM returned empty response'` |
| 抛异常 | `status: 'failed'`, `error: err.message` |

## 交付物

| 文件 | 行数(实际) | 说明 |
|------|-----------|------|
| `agents/executive/sec-state.ts` | 131 行 (重构) | Mock → 单阶段 LLM 委托；新增 `_buildTaskPrompt(step)` (Search/WebBrowser/default) + 空内容检测 |
| `tests/sec-state.test.ts` | 345 行 (新增) | 17 个测试覆盖 prompt 构造、happy path、空响应、异常、事件发送、modelRef 传递、tool_name 验证、Guards、act() 路由 |

## 验收维度

- [x] `Search` 类型步骤 → SecState 调用 LLM → 返回搜索结果文本
- [x] `WebBrowser` 类型步骤 → SecState 调用 LLM → 返回页面摘要
- [x] LLM 返回空 → `TaskResult.status = 'failed'`（含空字符串 + 纯空白两种 case）
- [x] LLM 调用异常 → `TaskResult.status = 'failed'` + 有意义错误信息（含 Error 对象 + 字符串 throw）
- [x] Mock adapter 单测：验证 `_buildTaskPrompt` 输出 + LLM 调用参数 + modelRef 传递
- [x] 所有现有测试通过（回归）— 390 tests，5 个失败为 adapter.test.ts 已有 Windows 环境问题
- [x] `npm run build` 零 TypeScript 报错
- [x] 代码审查 1 轮：源码无 Bug，补充 3 项测试增强（modelRef / tool_name event / 空响应 event 完整性）
