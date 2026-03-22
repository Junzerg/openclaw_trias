# Task 1.6: 行政分支与异步执行器 (Executive)

> **目标**：将法案转化为行动。编排并实现使用 Kahn 拓扑排序进行并行执行的基础，且实现对接 OpenClaw 工具的真实代理。
> **前置依赖**：[Task 1.3](task1.3_base_config.md) (需要其中 Adapter 能力与 Base)
> **对应目录**：`backend/src/agents/executive/`
> **预估耗时**：1 会话

## 需求说明

1. **`president.ts`**:
   - 总统作为拥有 VETO 权限的执行核心。通过 prompt 并调去 LLM 来审核法案，执行 `evaluate_act()` 判断是否否决。
2. **`sec-engineering.ts` 和 `sec-state.ts`**:
   - 两位核心干活部的部长，分别承担 `CodeExecution` 技术栈与 `Search` 等事务工作栈。在 `.execute_task(task)` 时，组装命令。
   - **注意**：在这里我们将结合 T0 完成的 `adapter.executeCode()` 等底层方法，将大模型编排出的 `Javascript / Python` 隔离法案推入现实层，获取并存储返回的执行结果！
3. **`engine.ts` (ExecutionEngine)**:
   - 行政大脑。由于法案产生的是一个带有向无环图依赖的数组（有的法案需要先建表再写接口），需要用 TS 复原 Kahn 排序。
   - 对没有互相依赖的同一层级（Level）步骤，采用 `Promise.allSettled()` 进行齐步执行。
   - 任意前置错误导致后续节点不发并标注 Skipped。记录 Token 总数并打包 `ExecutionReport`。

## 验收维度

- [x] Kahn 算法单元测试：给予预设 5 个具有链条式及发散式（如 A依赖B，C依赖B，D没依赖）的输入 Node，判定输出的分层数组层级排列正确。（新增：防陷入死循环检测）
- [x] Engine 测试能使用 Mock Executor 正常抛出并汇总一个执行报告。（包含：失败阻断 Skipped 级联测试）
- [x] 架构红线约束落实：使用统一原生 `this.emitEvent` 气泡调度（`SIGN_ACT`、`VETO`、`TOOL_CALL` 的全生命周期状态广播）。
