# Task 2-B · WebSocket 实时事件流

> **对应 Phase 2 子项**：2.2 WebSocket 实时事件流 + 2.2.2 事件序列化层
> **前置依赖**：Task 2-A（FastAPI 应用骨架 & TaskStore 可用）
> **预估工作量**：1 会话
> **状态**：✅ 完成

---

## 目标

实现 WebSocket 端点 `/ws/task/{task_id}`，将 Phase 1 的 `EventLogger` 中的结构化事件实时推送给前端客户端。验收：`wscat` 连接后可收到 JSON 事件流。

---

## 具体步骤

### Step 1：实现 WebSocket 连接管理器

新建 `openclaw_republic/server/ws_manager.py`：

```python
class ConnectionManager:
    """WebSocket 连接管理器。
    
    管理按 task_id 分组的 WebSocket 连接，
    支持多客户端同时订阅同一任务。
    """
    
    def __init__(self) -> None:
        # task_id → set of WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}
    
    async def connect(self, task_id: str, ws: WebSocket) -> None:
        """接受并注册一个 WebSocket 连接。"""
        await ws.accept()
        self._connections.setdefault(task_id, set()).add(ws)
    
    async def disconnect(self, task_id: str, ws: WebSocket) -> None:
        """移除断开的连接。"""
        if task_id in self._connections:
            self._connections[task_id].discard(ws)
            if not self._connections[task_id]:
                del self._connections[task_id]
    
    async def broadcast(self, task_id: str, event: dict) -> None:
        """向指定 task_id 的所有连接广播事件。"""
        if task_id not in self._connections:
            return
        dead: list[WebSocket] = []
        for ws in self._connections[task_id]:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections[task_id].discard(ws)
    
    def get_connection_count(self, task_id: str) -> int:
        """获取指定任务的连接数。"""
        return len(self._connections.get(task_id, set()))
```

### Step 2：实现 WebSocket 端点

替换 `openclaw_republic/server/websocket.py` 占位代码：

```python
from fastapi import WebSocket, WebSocketDisconnect

async def websocket_endpoint(
    websocket: WebSocket,
    task_id: str,
    manager: ConnectionManager,
) -> None:
    """WebSocket 端点 — /ws/task/{task_id}。
    
    连接后持续推送该任务的实时事件流，
    直到任务完成或客户端断开。
    """
    await manager.connect(task_id, websocket)
    try:
        # 保持连接，等待客户端断开
        while True:
            # 可选：接收客户端心跳/控制消息
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(task_id, websocket)
```

### Step 3：桥接 EventLogger → WebSocket 推送

在 `CyberGovernment` 或 Server 层注册消息总线订阅者，将事件转发到 WebSocket：

```python
# server/app.py 中的 lifespan 或 route 注册时：

async def _ws_bridge(event: BaseEvent) -> None:
    """消息总线 → WebSocket 桥接。
    
    订阅所有主题的事件，序列化后推送到对应 task_id 的 WS 连接。
    """
    if event.task_id is None:
        return
    ws_payload = event.model_dump(mode="json")
    await manager.broadcast(event.task_id, ws_payload)

# 注册到所有主题
for topic in TOPICS:
    government.bus.subscribe(topic, _ws_bridge)
```

### Step 4：注册 WebSocket 路由到 FastAPI

在 `app.py` 中注册 WebSocket 端点：

```python
@app.websocket("/ws/task/{task_id}")
async def ws_task(websocket: WebSocket, task_id: str):
    await websocket_endpoint(websocket, task_id, app.state.ws_manager)
```

### Step 5：事件序列化适配

确保 Phase 1 的 `BaseEvent` 的 `model_dump(mode="json")` 输出符合 PRD §4 的 JSON 格式：

```json
{
  "timestamp": "2026-03-20T19:00:00",
  "source_agent": "radical_mp",
  "action": "propose",
  "emotion": "excited",
  "intensity": 0.8,
  "payload": {"text": "建议使用快排..."},
  "task_id": "abc-123"
}
```

验证 `datetime` 序列化格式正确、`Enum` 值为字符串等。

### Step 6：编写测试

```
tests/
├── unit/
│   ├── test_ws_manager.py        # ConnectionManager 单测
│   └── test_event_serialization.py  # 事件序列化格式验证
└── integration/
    └── test_websocket_stream.py  # WebSocket 端到端集成测试
```

**测试要点**：
- ConnectionManager 的 connect / disconnect / broadcast 行为正确
- 多客户端同时连接同一 task_id 可同时收到事件
- 死连接自动清理
- 事件 JSON 格式符合 PRD §4 定义
- `BaseEvent` 子类（DebateEvent, VoteEvent 等）序列化正确
- WebSocket 端点可连接并收到事件
- 任务完成后连接正常关闭

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/server/ws_manager.py` | WebSocket 连接管理器（新建） |
| `openclaw_republic/server/websocket.py` | WebSocket 端点（替换占位） |
| `openclaw_republic/server/app.py` | 注册 WS 路由 & 桥接事件（更新） |
| `tests/unit/test_ws_manager.py` | ConnectionManager 单测 |
| `tests/unit/test_event_serialization.py` | 事件序列化验证 |
| `tests/integration/test_websocket_stream.py` | WebSocket 集成测试 |

---

## 验收标准

- [x] `wscat -c ws://localhost:8080/ws/task/{task_id}` 可成功建立连接
- [x] 提交 Petition 后，WS 连接实时收到 Pipeline 各阶段事件的 JSON 流
- [x] 事件 JSON 格式包含 `action`, `emotion`, `intensity`, `source_agent`, `timestamp` 等字段
- [x] 多个 `wscat` 客户端连接同一 task 可同时收到事件
- [x] 客户端断开后连接正确清理（无内存泄漏）
- [x] 所有单测、集成测试通过
- [x] `mypy --strict` 0 errors，`ruff check` 0 warnings

---

## 不包含（由后续 Task 处理）

- ❌ 完整 9 种 PRD §4 事件的 Pipeline 触发（→ Task 2-C）
- ❌ 历史事件回放（→ Task 2-D）
- ❌ 连接认证/鉴权（→ Phase 4）

---

## 后续衔接

- ← 前置：[Task 2-A · FastAPI 骨架](task2.1_fastapi_skeleton.md)
- → 后续：[Task 2-C · PRD §4 完整事件映射](task2.3_event_mapping.md)
