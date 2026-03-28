# Task 4.14 — 🌊 LLM 实时生成流 (Streaming) 接入与赛博终端

## 1. 目标
解决核心产品痛点：“在类似编写长篇代码的大任务时（耗时1-3分钟），大模型实际在飞速逐字生成（后台可见），但前台用户被迫陷入长达几分钟的死寂等待期”。
通过此任务打通从 OpenClaw 底层网关到前台 Phaser 画布的流媒体穿通道。

## 2. 现状分析
当前的前后端交互基于“离散式的业务事件（Event Action）”（例如 `status: running` 然后空挡跳到 `status: success`），极速的高频文本 Token 传输不在现有架构范畴内。为了避免拖垮 WebSocket 通道并且防止 React 全局状态机产生不可控级联崩溃，我们需要精心设计的“降频+隔离渲染”方案。

## 3. 架构设计与实现步骤

### Step 1: 后端 OpenClaw 适配器改造与流抛出
1. `backend/src/openclaw/adapter.ts`
   - 提供一个新的接口 `streamLLM(systemPrompt, prompt)` 
   - 使用异步生成器 `AsyncGenerator<string>` 逐步向上层返回从网关收到的流式文本分块。

2. `backend/src/agents/executive/sec-engineering.ts`
   - 重写代码生成的逻辑体，在组装底层调用时替换成流式处理。
   - 每拿到一次 chunk，就往外通过消息总线抛事件。

### Step 2: 极高频事件隧道节流阀（WebSocket Tunnel）
1. `backend/src/schemas/events.ts`
   - 新增枚举类型 `EventAction.STREAM_CHUNK` ('stream_chunk')
   - 定义 payload 类型，包括 `chunk: string`, `agent: string`, `completed: boolean`

2. `backend/src/server/ws-manager.ts`
   - 与常规高价值低频状态改变事件（计入 Ring Buffer 并持久化历史）不同，`stream_chunk` 不需要也不应该进入持久化历史 Ring Buffer（会清空重要消息）。
   - 实现**直接中转并限流短路下发**。利用如 RxJS 或者手写缓冲区实现类似 `debounce/throttle`。例如设定每 100 毫秒的窗口内归并所有的 chunks 组成单个 `content` 并推到连接终端，减少网络 I/O 开销与 React 负担。

### Step 3: 前端数据收集 (useWebSocket.ts)
1. `frontend/src/hooks/useWebSocket.ts`
   - 对 `stream_chunk` 进行特定判断，将其旁路由并作为特定的自变量或 EventBus 通知发送。尽量避免让 `dispatch` 污染 `AppContext` 引发右侧树全量挂载。
   
### Step 4: Phaser 内的骇客终端呈现
1. `frontend/src/game/scenes/ExecutiveScene.ts`
   - 创建动态赛博监视器：构建一个局部的 `Phaser.GameObjects.Text` 对齐在行政大厅中心，以极客霓虹绿样式展现。
   - 在 Scene 实例内部订阅接收流式通道广播，并逐步进行字符串拼接。由于单块可能很长，需启用硬换行截断或向上滚动机制。
   
## 4. 交付验收标准
1. **真实等待缩减**：提交长时间代码生成任务后，行政版面应立刻弹出文字版面并开始像黑客帝国代码流一般哗哗往下滚。
2. **性能压测防爆**：在最高速输出（50+ tokens/s）状况下：
   - WS 连接绝对不能断流重连。
   - 浏览器的 React 热帧渲染（FPS）不得受到明显影响（FPS 掉落不可超过 5）。
   - Ring Buffer 不会因包含大量的流媒体而致使用户丢失以往辩论历史的断线闪重连。
3. **闭环恢复**：当大模型最终完成输出进行本地沙箱正式执行后，赛博监控终端必须平滑切换或掩模隐藏，将控制权交还旧有的业务执行流（`executeAct` 的后续）。

## 5. 开发建议与注意事项
必须首先对前端 React 的状态渲染做出性能压测实验。如果 `wsEventBus.next()` 能够彻底绕开 React Fiber 层，直接送达 Phaser Canvas 则为最优解！建议用独立 RxJS `Subject<string>` 作为专用传递者。
