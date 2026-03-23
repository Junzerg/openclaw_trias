# Task 2.3: WebSocket 连接管理与事件推送

> **目标**：实现 WebSocket 连接管理器和 WS 端点，复现 Python 版 `ws_manager.py` + `websocket.py` 的功能。
> **前置依赖**：[Task 2.1](task2.1_http_server.md)（Express 应用骨架）
> **对应目录**：`backend/src/server/`
> **预估耗时**：1 会话

## 需求说明

### 1. `server/ws-manager.ts` — WebSocket 连接管理器

翻译 Python `ws_manager.py`（92 行），基于已有的 `ws` 包：

- **`ConnectionManager` 类**：
  - `_connections: Map<string, Set<WebSocket>>`：按 `task_id` 分组管理 WS 连接
  - `connect(taskId, ws)`：注册新连接到对应 `task_id` 的 Set
  - `disconnect(taskId, ws)`：移除连接，如 Set 为空则清理 key
  - `broadcast(taskId, event: object)`：向同一 `task_id` 的所有连接 `JSON.stringify` + `ws.send()`，失败的连接自动移除
  - `getConnectionCount(taskId) → number`

> **与 Python 版差异**：
> - Python 用 FastAPI 的 `WebSocket.accept()` / `WebSocket.send_json()`
> - TS 版用 `ws` 包的原生 `WebSocket`，通过 `ws.send(JSON.stringify(event))` 发送

### 2. `server/websocket.ts` — WebSocket 端点处理

翻译 Python `websocket.py`（78 行），处理 `/ws/task/:id` 的 WebSocket 连接：

- **`handleWebSocketConnection(ws, taskId, manager, appState)`**：
  - 注册 `ws.on('message', ...)` 监听器
  - 支持 `ping` 心跳响应 → `{ type: "pong" }`
  - 支持 `new_task` 控制指令 → 解析 `{ action: "new_task", data: { prompt } }`，触发新 Pipeline
  - 支持 `debug_*` 调试指令 → 直接广播模拟事件（开发调试用）
  - 注册 `ws.on('close', ...)` → 调用 `manager.disconnect()`

### 3. Express + ws 升级集成

在 `server/app.ts` 中集成 WebSocket 升级：

```typescript
import { WebSocketServer } from 'ws';

// 在 HTTP server 上挂载 WS 升级
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // 解析 URL，匹配 /ws/task/:id
  const match = request.url?.match(/^\/ws\/task\/(.+)$/);
  if (match) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleWebSocketConnection(ws, match[1], wsManager, appState);
    });
  } else {
    socket.destroy();
  }
});
```

## 前端兼容验证

前端 `useWebSocket.ts` 的关键行为：

1. 连接到 `ws://{host}/ws/task/{taskId}`
2. 收到 JSON → `JSON.parse` → 判断 `payload.action`
3. `action === 'status_update'` → 更新 `TaskStatusPayload`
4. 其他 action → 推入 `wsEventBus` → `EventMapper` 触发动画

TS 后端必须确保推送的 JSON 结构与前端 `WSEventPayload` 接口匹配：

```typescript
interface WSEventPayload {
  action: string;
  data?: any;
  intensity?: number;
  timestamp?: number;
  [key: string]: unknown;
}
```

## 验收维度

- [x] `ws-manager.test.ts`：验证 `connect` / `disconnect` / `broadcast` 行为，包括死连接自动清理 — **21 个单测全绿**
- [x] `websocket.test.ts`：验证 `ping` 响应、`new_task` 指令解析、`debug_*` 指令转发 — **23 个端到端测试全绿**
- [x] 手动 `wscat -c ws://localhost:8000/ws/task/test-123` 可成功建立连接
- [x] 发送 `ping` 字符串 → 收到 `{ type: "pong" }` 响应

## 完成状态

> ✅ **已完成** — 2026-03-23，经过 10 轮极限安全审查

### 测试报告

```
 ✓ tests/server/ws-manager.test.ts  (21 tests)    7ms
 ✓ tests/server/websocket.test.ts   (23 tests) 2473ms

 Test Files  5 passed (5)
      Tests  110 passed (110)
 TypeCheck   0 errors
```

### 安全加固清单 (11 层防御矩阵)

| # | 防御层 | 文件 | 风险等级 |
|---|--------|------|----------|
| 1 | 顶层 async try-catch 防 unhandled rejection | websocket.ts | Fatal |
| 2 | JSON 解析防御 (非JSON/数组/null/空串/二进制) | websocket.ts | High |
| 3 | Query string 剥离防 taskId 污染 | app.ts | High |
| 4 | maxPayload 64KB 防 CPU DoS (JSON.parse 阻塞) | app.ts | Critical |
| 5 | RFC 6455 Ping/Pong 心跳防半开连接 FD 耗尽 | websocket.ts | Critical |
| 6 | 零 Timer 时间戳限流 50帧/秒 防消息洪峰 | websocket.ts | Critical |
| 7 | TCP Socket error 监听防握手期 ECONNRESET 崩溃 | app.ts | Fatal |
| 8 | 单任务 100 连接惊群限流防 Broadcast OOM | ws-manager.ts | Critical |
| 9 | Fire-and-Forget 广播 + bufferedAmount 慢读取者强杀 | ws-manager.ts | Fatal |
| 10 | Payload 注入防线 (Object.assign 顺序反转) | websocket.ts | High |
| 11 | PetitionRequestSchema 复用防验证绕过 | websocket.ts | High |
| 12 | decodeURIComponent 防跨协议状态脱节 | app.ts | High |
| 13 | console %j 格式化防终端日志注入 (CWE-117) | websocket.ts, ws-manager.ts | Medium |

