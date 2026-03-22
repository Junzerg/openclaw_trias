# Phase 1 · 核心编排层翻译 (Python → TypeScript)

> **目标**：将 Python 版的三权分立逻辑 1:1 无损重构为 TypeScript，并且脱离 Mock，直接使用 T0 完成的 OpenClaw Adapter。
> **前置依赖**：[Phase 0](../phase0/phase0_overview.md) 完成
> **总预估耗时**：8 个会话（按拆分粒度，每次会话实现约 300~500 行核心逻辑与单元测试）

---

## 拆解策略 (单次会话闭环)

经过代码量和上下文复杂度测算，如果按之前的 6 个粗粒度 Task 进行，某些会话（特别是立法分支和数据定义体系）可能需要手写并在单次内存中兜住近 1000 行逻辑，非常容易造成 LLM 遗忘和联调超时。

所以，最终拆分为 **8 个严格保障能在“1个会话内编写+单测验证+修复闭环”** 的颗粒度：

| 任务 | 核心范围 | 预估代码量 | 为什么能单次会话闭环？ |
|------|---------|-------------|-----------------------|
| ✅ **[1.1 数据结构契约](task1.1_schemas.md)** | `schemas/*.ts` | ~300 行 | 纯数据模型与 Zod 校验，将 Python Pydantic 1:1 翻译，不带业务逻辑。 |
| ✅ **[1.2 状态机与总线](task1.2_bus.md)** | `bus/*.ts` | ~300 行 | `BillLifecycle` 的 11 个节点跳跃校验，以及简单的 Pub/Sub 事件中心，边界异常极度清晰，编写单元测试十分轻快。 |
| ✅ **[1.3 配置与代理基类](task1.3_base_config.md)** | `config/*.ts`, `agents/base.ts` | ~400 行 | 把 YAML 和 SOUL 解析搞定，将 T0 的 OpenClaw `callLLM` 注入被重写的 `BaseAgent` 抽象基类，并完成 5 层 RBAC 权限系统。 |
| ✅ **[1.4 立法分支核心算法](task1.4_legislative_mps.md)** | `conflict-score.ts`, `radical-mp.ts`, `conservative-mp.ts` | ~450 行 | 两派议员本身很简单，难点在 `ConflictScore` 复杂计分逻辑。将其和议长抽离，能在本会话保证计分算法的极致准确。 |
| **[1.5 立法引擎与议长](task1.5_legislative_debate.md)** | `debate.ts`, `speaker.ts` | ~500 行 | 专注于多轮 Critique-Rebuttal 循环的编排调度（`DebateEngine`）、计票机制、以及议长在满足特定阈值时的介入判断。 |
| **[1.6 行政分支与执行器](task1.6_executive.md)** | `executive/*.ts` (Engine, President, Secs) | ~450 行 | 核心难点在 `engine.ts` 的拓扑排序算法，在单向执行不卡住的前提下并行调用 OpenClaw 工具。 |
| **[1.7 司法分支与宪法校验](task1.7_judicial.md)** | `judicial/*.ts` (ChiefJustice, RulesEngine...) | ~500 行 | 多维度的审查模式，正则匹配与大模型语义对比组合，逻辑高内聚。 |
| **[1.8 赛博政府主流水线](task1.8_government.md)** | `government.ts` | ~430 行 | 将大厂级别的装配线拼接完整，打通 Pipeline 从 Petition 到 Delivered，注入真实的事件监听。 |

---

## 验收与边界保障

1. 每一个 Task 结束前，必须提供 Vitest 通过的最简测试报告（哪怕是 mock 输入输出层面）。
2. 在 `government.ts` (1.8) 到来之前，各子系统只需保证**自己模块边界内的纯函数能力和类行为闭环**。
3. 从 1.4 开始，所有的 Agent `.ts` 文件不再通过返回固定文字 Mock，而是调用继承自 `BaseAgent` 层的真实 `OpenClawAdapter`。
