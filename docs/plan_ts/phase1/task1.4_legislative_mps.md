# Task 1.4: 立法分支 Ⅰ - 议员与分歧度引擎

> **目标**：构建左右翼两名议员基本模型对象，并实现最核心的独立计分器 `ConflictScoreEngine`。
> **前置依赖**：[Task 1.3](task1.3_base_config.md)
> **对应目录**：`backend/src/agents/legislative/` (部分)
> **预估耗时**：1 会话

## 需求说明

1. **`radical-mp.ts` 与 `conservative-mp.ts`**:
   - 继写 `BaseAgent`。
   - 实现各自对应职责：如 `RadicalMP` 负责 `.propose(petition)` 与 `.rebut(critique)`，并在 Prompt 指令拼接包裹后丢给基类的 `this.callLLM()`。
   - 实现 `Voter` 协议预支支持 `.vote()` 方法获取 boolean 的共识评价。
2. **`conflict-score.ts`**:
   - 该部分是纯规则逻辑。根据 Python 里的字数匹配、叹号匹配、正则分析、关键字寻找（粗暴、激进/停、保守等）实现一套混合计算器。
   - 暴露 `ConflictScoreEngine.compute(proposal, critique)` 返回一个 `1-100` 的剧烈程度数字，以及一个趋势鉴定（缓和/升级等）。

## 验收维度

- [x] 两个 MP 类的类型正确继承实现，`role` 配置对应到正确的 SOUL 名称。
- [x] 单测针对 `ConflictScoreEngine` 输入预设的一组温和 Prompt 与一组争锋相对的带脏词 Prompt，确认出来的分数差异符合 0~100 的线性预期，并不会报错。

---

## 完成记录 (Completion Log)

- **完成时间**：2026-03-21
- **里程碑**：
  1. 完成了 `ConflictScoreEngine` Python 到 TS 的 1:1 无损翻译，精确还原基于正则与中文中缀匹配的打分算法（包含妥协、冲突、覆盖率计算及 `rm -rf` 强制 Lv3 处理等）。
  2. 完成 `RadicalMP` 与 `ConservativeMP` 的装配，它们能够接入最新的 `OpenClawAdapter`，用强类型提取 `LLMResponse.content` 并完成 Vote 和 Propose。
  3. 补充了 11 个严密的 Vitest 单元测试用例，涵盖空值、分阶段状态、和趋势计算异常，实现逻辑与类型双闭环。
