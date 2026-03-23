# Task 1.5: 立法分支 Ⅱ - 辩论引擎与议长

> **目标**：构建将单点议员能力串联起来的 `DebateEngine` 状态流，以及能够对全场进行控场和降温的 `Speaker`。
> **前置依赖**：[Task 1.4](task1.4_legislative_mps.md)
> **对应目录**：`backend/src/agents/legislative/` (剩余部分)
> **预估耗时**：1 会话

## 需求说明

1. **`speaker.ts`**:
   - 议长 `Speaker` 继承 `BaseAgent`，拥有独立方法 `intervene()`。当分歧度过高时，向大模型抛入过往争议文本，获取议长的冷静控场词。
2. **`debate.ts` (辩论引擎与投票机)**:
   - 将 Python 中包含 `DebateRound`, `DebateResult`, `VoteRecord` 的流转载体声明好（可用前面的 1.1 Data Model 兜底）。
   - 编写重核心 `DebateEngine.runDebate(speaker, radical, conservative, petition)`：
     - 使用 `for (let i = 1; i <= maxRounds; i++)` 进行循环攻防轮换。
     - 每次迭代产生 Proposal 应对 Critique/Rebuttal。
     - 结合使用前一 Task 编写完成的 ConflictScore 计算当前轮的热度。
     - [架构优化] **移除 `eventPublisher` 独立回调**，内部直接运用传入的 `radical` / `conservative` / `speaker` 实例自带的 `BaseAgent.emitEvent` 将进度事件（`propose`, `brawl`, `order`）辐射到事件总线。
     - 注意对齐 TS 规范 `DebateEventSchema`，发言内容字段从 Python 版的 `text` 修正为更为标准的 `statement`。
     - 若分数超标促发提早中断或 Speaker 接管，同样由 Speaker 借由 `emitEvent` 抛出 `ORDER!` 与冷静声明。
   - 编写 `VotingMachine` 取议员对象的 Vote 方法进行计票。
   - 优化 `speaker.generateAct()`，摒弃原本 Python 中忽略大模型提炼结果的占位逻辑，**真实地将其推断的内容填入最终执行法案的步骤中**。

## 验收维度

- [x] 由于摒弃了游离的 `eventPublisher`，`DebateEngine` 单元测试支持通过直接在代理对象上打桩（如 `vi.spyOn(radical, 'emitEvent')`）来验证状态是否正确迭代 3 轮；且每次 `round_number`、`statement` 和生成的 `conflict_score` 都有精准对齐抛出。
- [x] 测试中消除了 `as unknown as Type` 等不规范强转，`LLMResponse` 的 Mock 数据严格附带了必选的 `rawOutput` 属性，强类型推导严丝合缝。
- [x] 能够成功完成 `runDebate` 返回包装好所有来往内容的 `DebateResult` 终态，而且 `generateAct` 测试成功验证了提取并使用了 LLM 的决议产出。
