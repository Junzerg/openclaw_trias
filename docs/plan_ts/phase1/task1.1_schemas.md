# Task 1.1: 数据结构契约 (Schemas)

> **目标**：将 Python 版的 Pydantic 模型（事件、法案、判决、消息）1:1 翻译为 TypeScript 的 Interface 与 Zod 校验 Schema，为后续所有模块提供类型安全底座。
> **前置依赖**：无
> **对应目录**：`backend/src/schemas/`
> **预估耗时**：1 会话

## 需求说明

我们需要抛弃 Python 中的 `BaseModel`，转而使用 `zod` 在 TS 中做运行时强校验，并根据它导出静态 TS 类型。

1. **`events.ts` (对齐 WebSocket 契约)**:
   - 翻译 `EventAction` 和 `EmotionType` 枚举。
   - 定义核心 `BaseEvent` 与子类 (`DebateEvent`, `VoteEvent`, `VetoEvent`, `ExecutionEvent`, `JudgmentEvent`)。
   - **注意**：这部分的字段命名与类型必须和前端 `EventMapper.ts` 完全看齐。
2. **`act.ts` (法案与执行流转)**:
   - 定义 `ActStep`, `ExecutionTask`, `TaskResult`, `Act`, `ExecutionReport`。
   - 对应 Python 源码中的所有字段描述。
3. **`verdict.ts` (司法判决实体)**:
   - 定义 `Verdict`, `JudgmentPayload`。
4. **`messages.ts` (历史流水)**:
   - 定义 `AgentMessage`。

## 验收维度

- [x] 完成上述 4 个 TypeScript 文件的编写，全部采用 `zod` 的 `z.object()` 形式并运用 `z.infer<typeof ...>` 提取类型。
- [x] 编写一个简单的 `vitest` 测试 `schemas.test.ts`，随意构造一组符合法案/事件格式的 Object，调用 `.parse()` 通过。
- [x] 确保字段命名（如下划线 `round_number`、`conflict_score`）直接继承自原库，不要擅自改成驼峰，以免前端 WebSocket 强关联解析崩溃。
