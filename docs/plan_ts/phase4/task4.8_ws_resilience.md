# Task 4.8 — WS 韧性增强 & 断线事件补发

> **前置依赖**：Task 4.1
> **涉及端**：🖥️🔧 前后端
> **预估工作量**：⭐⭐⭐

---

## 目标

企业级 WebSocket 连接韧性——指数退避重连、断线期间事件不丢失、重连后自动补发。

## 核心产出

### 前端 — `useWebSocket.ts` 重构

1. **指数退避重连**：
   - base = 1s, cap = 30s, jitter = ±20%
   - 公式：`delay = min(base * 2^attempt, cap) * (1 + random(-0.2, 0.2))`
   - 取代当前的固定 3s 重连

2. **Event ID 追踪**：
   - 记录最后收到的 `event_id`
   - 每条从后端收到的事件 payload 中提取 `event_id` 字段

3. **重连后自动 Replay**：
   - WebSocket `onopen` 后立即发送 `{ action: 'replay', data: { after_event_id: N } }`
   - 后端补发遗漏事件后走正常的 `wsEventBus.next()` 流程

4. **连接状态指示器**：
   - 状态枚举：`connecting` | `connected` | `reconnecting` | `offline`
   - 暴露给 AppContext → Header 中显示带颜色的状态点

### 后端 — `ws-manager.ts` Ring Buffer

1. **每任务事件缓冲区**：
   - `Map<taskId, CircularBuffer<{event_id, payload}>>` 
   - 容量 max 500 条
   - 每条广播的事件自动写入缓冲区并标记递增 `event_id`

2. **event_id 全局递增计数器**：
   - per-task atomic counter
   - 注入到每条广播事件的 JSON payload 中

### 后端 — `websocket.ts` Replay 指令

- 新增 `replay` action 处理：
  - 解析 `after_event_id`
  - 从 Ring Buffer 中筛选 `> after_event_id` 的事件
  - 逐条发送给请求的 client

### 后端 — `schemas/events.ts`

- 所有事件 payload 添加可选 `event_id?: number` 字段

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| MODIFY | `frontend/src/hooks/useWebSocket.ts` |
| MODIFY | `backend/src/server/ws-manager.ts` |
| MODIFY | `backend/src/server/websocket.ts` |
| MODIFY | `backend/src/schemas/events.ts` |

## 验证计划

### 自动化测试
1. Ring Buffer 边界测试：满/空/越界
2. Replay 指令正确性：补发 `> after_event_id` 的事件子集
3. 指数退避公式正确性：delay 不超过 cap

### 手动测试
1. 启动 Pipeline → 中途断网（DevTools Network offline） → 恢复 → 确认重连后缺失事件自动补发
2. 观察 Header 连接状态指示器颜色变化
