# Task 2.2: 任务持久化与异步任务队列

> **目标**：将 Python 版 `task_store.py`（SQLite 持久化）和 `task_queue.py`（异步任务调度）翻译为 TypeScript。
> **前置依赖**：[Task 2.1](task2.1_http_server.md)（`schemas.ts` 类型已定义）
> **对应目录**：`backend/src/server/`
> **预估耗时**：1 会话

## 需求说明

### 1. `server/task-store.ts` — SQLite 持久化

翻译 Python `task_store.py`（315 行），使用 `better-sqlite3`（同步 API，性能优异）：

- **`TaskStatus` 枚举**：`PENDING | RUNNING | COMPLETED | FAILED`
- **`TaskRecord` 接口**：`task_id`, `petition`, `status`, `result?`, `bill_state`, `created_at`, `updated_at`
- **`TaskStore` 类**：
  - `initialize()`：创建 4 张表（`tasks`, `events`, `acts`, `verdicts`），启用 `PRAGMA foreign_keys`
  - `createTask(taskId, petition) → TaskRecord`
  - `getTask(taskId) → TaskRecord | null`
  - `updateTask(taskId, updates) → void`
  - `countTasks() → number`
  - `listTasks(offset, limit) → TaskRecord[]`
  - `storeEvent(taskId, sourceAgent, action, emotion, intensity, payload) → void`
  - `getTaskEvents(taskId) → EventRow[]`
  - `storeAct(taskId, actJson) → void`
  - `getTaskAct(taskId) → ActRow | null`
  - `storeVerdict(taskId, constitutional, ruling, evidence) → void`
  - `getTaskVerdict(taskId) → VerdictRow | null`
  - `close() → void`

> **差异点**：Python 版用 `aiosqlite`（异步），TS 版用 `better-sqlite3`（同步）。因为 Node.js 单线程模型下，SQLite 的同步调用实际上更简洁且性能更好（避免了事件循环上下文切换）。方法签名保持同步即可。

### 2. `server/task-queue.ts` — 异步任务队列

翻译 Python `task_queue.py`（74 行）：

- **`TaskQueue` 类**：
  - 构造器接受 `maxConcurrent`（默认 1），内部用自定义信号量或 `p-limit` 控制并发
  - `submit(taskId, fn) → void`：提交一个异步任务（`() => Promise<void>`）到队列
  - `cancel(taskId) → boolean`：取消尚未完成的任务
  - `runningCount` / `pendingCount` 只读属性

> **设计选择**：鉴于 `better-sqlite3` 是同步 API，`TaskQueue` 内部的 `_run_petition` 函数仍然是异步的（因为 `CyberGovernment.receivePetition()` 是异步的），但 DB 写入不需要 `await`。
>
> **实现说明**：`cancel()` 方法在 `ITaskQueue` 接口中未声明，当前代码路径无需取消逻辑，后续如有需要再补充。

## 实现总结

> ✅ **已于 2026-03-23 完成。零致命 Bug，66 个测试全通过。**

### 关键设计决策

| 决策 | 理由 |
|------|------|
| **WAL 模式** | `PRAGMA journal_mode = WAL` 提升并发读取性能 |
| **Thunk 延迟执行** | `submit()` 只入队 `() => Promise<void>`，drain 循环在空闲 slot 时才 invoke factory，防止 Promise 提前逃逸 |
| **`queueMicrotask` drain** | 确保 factory 不在 submit 同步调用栈内执行，重入安全 |
| **`constitutional` 存为 INTEGER** | SQLite 无 BOOLEAN 类型，存 0/1，由路由层 `Boolean()` 转换 |
| **JSON 原样透传** | `payload`/`act_json`/`evidence` 返回原始字符串，不做解析假设 |
| **`updateTask` 白名单** | 运行时校验列名防止 TS 类型擦除后的 SQL 注入 |

### 产出文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `server/task-store.ts` | ~275 | SQLite 持久化，实现 ITaskStore 全部 12 个方法 |
| `server/task-queue.ts` | ~96 | 异步任务队列，手写 semaphore + drain 循环 |
| `tests/server/task-store.test.ts` | ~290 | 26 个测试：CRUD、分页、事件/法案/判决、PK 冲突、SQL 注入防御、文件持久化 |
| `tests/server/task-queue.test.ts` | ~205 | 6 个测试：thunk 延迟、串行/并发、错误恢复、FIFO |

### 测试结果

```
 ✓ task-store.test.ts  (26 tests)
 ✓ task-queue.test.ts  ( 6 tests)
 ✓ routes.test.ts     (34 tests) ← 回归通过
 TypeCheck: npm run build — 零错误
```

## 验收维度

- [x] `task-store.test.ts`：覆盖 CRUD 操作（创建任务 → 查询 → 更新状态 → 列表分页 → 事件存储 → 法案/判决存取）
- [x] `task-queue.test.ts`：验证并发控制（提交 3 个任务，`maxConcurrent=1` 时只有 1 个同时运行）
- [x] SQLite 文件自动在 `data/tasks.db` 创建且可持久化（文件系统持久化测试验证）
- [x] `better-sqlite3` 成功安装（依赖原生 C++ binding），`npm run build` 编译通过

