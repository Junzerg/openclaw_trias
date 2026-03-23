# Task 2.4: Pipeline 桥接与事件流集成

> **目标**：将 Task 2.1~2.3 的所有组件集成，实现完整的事件桥接链路：`CyberGovernment.bus` → WS broadcast + DB 持久化。
> **前置依赖**：[Task 2.1](task2.1_http_server.md)、[Task 2.2](task2.2_task_store.md)、[Task 2.3](task2.3_websocket.md)
> **对应目录**：`backend/src/server/app.ts`（主要修改）
> **预估耗时**：1 会话

## 需求说明

### 1. 完善 `server/app.ts` 的 Lifespan 逻辑

翻译 Python `app.py` 中的 `lifespan()` 上下文管理器核心逻辑：

#### WS 桥接函数 `_wsBridge(event)`
```typescript
async function _wsBridge(event: BaseEvent): Promise<void> {
  if (!event.task_id) return;
  const wsPayload = serializeEvent(event);  // 将 BaseEvent 转为前端兼容 JSON
  wsManager.broadcast(event.task_id, wsPayload);
}
```

#### DB 桥接函数 `_dbBridge(event)`
```typescript
async function _dbBridge(event: BaseEvent): Promise<void> {
  if (!event.task_id) return;
  
  // 1. 存储事件到 events 表
  taskStore.storeEvent(event.task_id, event.source_agent, event.action, ...);
  
  // 2. 特殊事件处理
  if (event.action === 'vote_passed' && event.payload?.act) {
    taskStore.storeAct(event.task_id, JSON.stringify(event.payload.act));
  }
  if (['constitutional', 'unconstitutional'].includes(event.action) && event.payload?.verdict) {
    taskStore.storeVerdict(event.task_id, ...);
  }
}
```

#### 注册订阅
```typescript
// 启动时：注册消息总线订阅 → WS + DB 双通道
const TOPICS = ['legislation', 'execution', 'judiciary', 'lifecycle'];
for (const topic of TOPICS) {
  government.bus.subscribe(topic, _wsBridge);
  government.bus.subscribe(topic, _dbBridge);
}
```

### 2. 事件序列化适配 (`serializeEvent`)

确保 `BaseEvent` 转换为前端期望的 `WSEventPayload` 格式：

```typescript
function serializeEvent(event: BaseEvent): Record<string, unknown> {
  return {
    action: event.action,           // EventAction 枚举值 → string
    source_agent: event.source_agent,
    emotion: event.emotion,
    intensity: event.intensity,
    timestamp: event.timestamp.toISOString(),
    task_id: event.task_id,
    // 展开 payload 字段到顶层（Python 版 model_dump 行为）
    ...event.payload,
  };
}
```

> **关键**：Python 的 `BaseEvent.model_dump(mode="json")` 会自动将 `Enum` 转为 `string`、`datetime` 转为 ISO 格式。TS 版需要手动实现等效序列化。

### 3. 完善 `_runPetition` 后台任务函数

将 Task 2.1 的 `_runPetition` 占位逻辑替换为真实 Pipeline 调用：

```typescript
async function _runPetition(taskId: string, prompt: string, state: AppState): Promise<void> {
  try {
    state.taskStore.updateTask(taskId, { status: TaskStatus.RUNNING });
    const result = await state.government.receivePetition(prompt, undefined, taskId);
    state.taskStore.updateTask(taskId, { status: TaskStatus.COMPLETED, result });
  } catch (error) {
    state.taskStore.updateTask(taskId, { status: TaskStatus.FAILED, result: String(error) });
  }
}
```

### 4. 启动与关闭生命周期

```typescript
// 启动
await government.inaugurate();
taskStore.initialize();

// 关闭 (SIGINT / SIGTERM)
process.on('SIGINT', async () => {
  await government.shutdown();
  taskStore.close();
  process.exit(0);
});
```

## 验收维度

- [x] 启动 TS 后端 → `POST /petition` → Pipeline 实际运行
- [x] `wscat` 连接后，实时收到 `state_change`、`propose`、`brawl`、`order`、`vote_passed`、`sign_act`、`tool_call`、`constitutional`/`unconstitutional` 事件 JSON 流
- [x] 事件同时持久化到 SQLite `events` 表
- [x] `vote_passed` 事件自动保存法案到 `acts` 表
- [x] `constitutional`/`unconstitutional` 事件自动保存判决到 `verdicts` 表
- [x] `GET /task/:id/debate` 返回正确的辩论记录
- [x] `GET /task/:id/act` 返回正确的法案 JSON
- [x] `GET /task/:id/verdict` 返回正确的判决详情
- [x] 编写集成测试 `server/integration.test.ts`：模拟完整 Pipeline → 验证 DB + WS 事件链路

---

## 💡 实施笔记 (Implementation Notes)

1. **高内聚解耦模块 (`pipeline-bridge.ts`)**：没有直接将所有逻辑塞入 `app.ts`，而是独立为 `pipeline-bridge.ts` 以提供高度可测试的工厂方法 (`createWsBridge` / `createDbBridge`)，从而彻底隔离了生命周期。
2. **零阻断错误隔离 (`runPetition`)**：实现了健壮的 FAILED 状态最终一致性兜底更新，并且 `WsBridge` 和 `DbBridge` 内置了 `try-catch` 防止单条日志落盘失败或个别 WS 客户端断连导致系统事件流直接崩溃。
3. **入库序列化优化与数据重组设计**：与 Python 版将整包 `BaseEvent` 统统序列化入库的粗暴方式不同，TS 版底层的 `BaseAgent.emitEvent` 默认将 `payload` 内容展平在了根域与内部 `payload` 域两端，因此 `_dbBridge` **仅截取 `JSON.stringify(event.payload ?? {})`** 落盘。这不仅大幅优化了 SQLite `events` 表的数据容量，且在 `routes.ts` 做 `GET /task/:id/debate` 的 JSON 提取时天然匹配兼容 `payload.statement` 与 `payload.conflict_score` 的取值。
4. **强类型约束修正**：修正了 `app.ts` 和 `websocket.ts` 中针对 `ConnectionManager` 参数类型定义，统一对齐到了 `IConnectionManager` 依赖倒置。
5. **优雅关闭 (Graceful Shutdown)**：在 `index.ts` 捕获 `SIGINT/SIGTERM` 信号后，通过 `shutdownLifecycle` 预先解绑 MessageBus 的悬挂事件处理器并断开 HTTP 层 Socket，确保 SQLite WAL 写入完成后才关闭数据库进程。
