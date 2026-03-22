# Task 1.2: 状态机与总线 (Bus & State Machine)

> **目标**：实现无业务耦合的消息总线订阅器和强一致性的法案生命周期状态机。
> **前置依赖**：[Task 1.1](task1.1_schemas.md) (需要其中引用的事件 Enum 与 Base 类型)
> **对应目录**：`backend/src/bus/`
> **预估耗时**：1 会话

## 需求说明

1. **`state-machine.ts` (法案生命周期)**:
   - 抄写 11 个 `BillState` (PETITION, DRAFTING, DEBATING, VOTED, SIGNED, VETOED, EXECUTING, REVIEWING, CONSTITUTIONAL, UNCONSTITUTIONAL, DELIVERED)。
   - 翻译 `VALID_TRANSITIONS` 合法跳转矩阵（注意两条从后往前的退回：VETOED→DRAFTING，UNCONSTITUTIONAL→DRAFTING）。
   - 实现 `BillLifecycle` 类及其 `transition` 跳转逻辑、历史追溯机制，遇到非法流转抛出异常。
2. **`message-bus.ts` (事件中心 Pub/Sub)**:
   - 实现包含 `publish`, `subscribe` 的单例或通用 Class `MessageBus`。
   - 它是后续 `government.ts` 让三权在时间线上解耦、互相通知核心。
3. **`event-log.ts`**:
   - 轻量级的数组记录工具，能够保存抛出的 event 备查。

## 验收维度

- [x] ~~`state-machine.test.ts`~~(`bus.test.ts`)：编写单测模拟一个法案从发起到交付的过程。故意写一个违规越轨逻辑（如 DRAFTING -> SIGNED），预期成功抛出报错。
- [x] ~~`message-bus.test.ts`~~(`bus.test.ts`)：设定一个 EventTopic，让注册的订阅者回调正确触发，并支持异步 Publish。

## 进展与优化说明 (Walkthrough)

**状态: ✅ 已完成**

1. **`state-machine.ts`**: `BillState` 的 11 个状态及跳转约束已完全基于 TypeScript 实现。非法流转会主动抛出 `InvalidTransitionError`，并支持追溯 `history`。
2. **`message-bus.ts`**: 实现为了基于 `Map<Topic, Set<Handler>>` 的内存消息中心。
   - **并发优化**：对于具有多个订阅者的 Topic，原串行 `await` 逻辑被重修为 `Promise.all` 并发机制。能够让三权分支之间的 Agent 处理做到真正的解耦与时间线并发响应（避免某一个 Agent 停顿而阻塞全场的情况）。
3. **`event-log.ts`**: 包含了按条件过滤的 `get_events` 方法，及支持抛出供 WebSocket 推送序列化的方法。
4. **单测保障 (`backend/tests/bus.test.ts`)**: 涵盖了状态流转闭环、闭环错误判定以及消息总线的防崩溃边界测试，9 个单测用例 100% 通过。
