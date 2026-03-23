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

- [ ] `ws-manager.test.ts`：验证 `connect` / `disconnect` / `broadcast` 行为，包括死连接自动清理
- [ ] `websocket.test.ts`：验证 `ping` 响应、`new_task` 指令解析、`debug_*` 指令转发
- [ ] 手动 `wscat -c ws://localhost:8000/ws/task/test-123` 可成功建立连接
- [ ] 发送 `ping` 字符串 → 收到 `{ type: "pong" }` 响应
