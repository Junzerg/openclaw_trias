# Task 1.8: 主编排器流转线 (CyberGovernment)

> **目标**：最顶层业务逻辑封装。装配 1.1 至 1.7 所有组件，接上电源走过一遍。
> **前置依赖**：全面完成 1.1 ~ 1.7
> **对应目录**：`backend/src/government.ts`
> **预估耗时**：1 会话

## 需求说明

这是本系统的超级引擎类 `CyberGovernment`，对外也是开放 API/Server 的唯一核心挂载点。包含以下流程：
1. **组阁 (Initialization)**：从 `config/souls` 读取人设，实例化所有三权的 7 大重磅角色；实例化辩论与执行双引擎。
2. **入禀 (Petition Handler)**：接收一句文本（或上下文）。启动 `BillLifecycle` 的状态机流转。
3. **流水线调度 (`_run_pipeline()`)**:
   - **循环兜底**：法案遇到 VETO (否决) 或 UNCONSTITUTIONAL (违宪) 时，使用 `while` 循环让该法案携带否决/违宪建议，重回 DRAFTING 让立法引擎再次工作生成优化版，设定默认 3 次的最大重回限制防止死锁。
   - **分步调转**：
     - 立法期：调用 `DebateEngine` 进行争辩；如果通过则交由总统。
     - 签署期：让 `President` 执行判别；
     - 执行期：扔给 `ExecutionEngine` 拿到任务产物日志；
     - 审查期：推送给 `ChiefJustice` 下达神圣判决；
   - **向外推流**：沿途每一个环节发生的 `EventAction` 全数向 `MessageBus` 与直接传入绑定的 WS publisher 中抛送。

## 验收维度

- [x] `government.ts` 能编译通过完全没有 TS 爆红报错（这意味着长达数周所有的子项目之间的数据对象引用，和方法的对接全部是对齐严合的）。
- [x] 基于预先写的 `terminal-runner.ts` 等命令行启动入口，运行诸如 `"帮我写一个 python 的 helloworld 的本地终端程序并运行它"` 返回出执行通过日志结束。全流程走通！

## QA 与修复记录 (Phase 1 Closure)
根据最终代码推演与 `vitest` 全流程验证，已修复并优化以下问题，实现逻辑 100% 严密闭环：
1. **WebSocket Traceability (Telemetry 断开 Bug)**：修复了 `DebateEngine` 和 `ExecutionEngine` 内部自发送事件时产生随机 `task_id` 的严重错误，强行透传 `billId` 作为上下文 `taskId`，确保 UI 事件钩子完美触发。
2. **WebSocket 荷载结构修复**：修改 `BaseAgent.emitEvent` 使用展开运算符打平传入的附加参数，还原被错误嵌套的 `event.payload` 字段以完全迎合 Python 版与现有前端的 `EventMapper.ts` 解析标准。
3. **消除冗余广播**：清理了 `CyberGovernment` 中重复向 `"legislation"` 与 `"judiciary"` 等频道发送事件的脏代码（因为底层 Agent 已经实现了自驱动广播），避免了前端因重复接受推送引发的视觉闪烁甚至卡死。
4. **修复配置加载硬编码**：完善 `config/loader.ts`，确保其实际使用注入的 `configDir` 加载 YAML，修复了只能在全局执行路径下工作的上下文错位 Bug。
5. **测试覆盖**：编写了针对 Pipeline 四条主线的 `government.test.ts` 测试，并额外追加了由于连续 Veto/违宪 导致 `maxRetries` 用尽的断路器退出情况。目前 4 测用例 100% 稳健通过！
