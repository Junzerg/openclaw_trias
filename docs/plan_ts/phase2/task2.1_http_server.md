# Task 2.1: HTTP 服务骨架与 REST API

> **目标**：搭建 Express.js 应用骨架，实现 Python 版 `routes.py` + `schemas.py` 的全部 REST API 端点。
> **前置依赖**：[Phase 1](../phase1/phase1_overview.md) 完成
> **对应目录**：`backend/src/server/`
> **预估耗时**：1 会话
> **状态**：✅ **已完成** — 经过 8 轮深度 QA 审查，共修复 18 处隐患（含 5 个致命级），34 个防弹单测全绿

## 交付产物

| 文件 | 行数 | 说明 |
|------|------|------|
| `server/schemas.ts` | 82 | Zod 请求/响应模型，含 `.trim()` 空白拦截 |
| `server/app.ts` | 133 | Express 5 应用工厂 + Stub 接口 + 全局错误中间件 |
| `server/routes.ts` | 280 | 6 个 REST 端点 + 深度防御性数据清洗 |
| `tests/server/routes.test.ts` | 647 | 34 个极端场景防弹单测 |

## 需求说明

### 1. `server/app.ts` — Express 应用骨架

- 创建 Express 应用实例，配置 CORS 中间件（显式 Methods 列表 + `allowedHeaders: '*'`）
- 定义全局 `AppState` 接口，持有：
  - `government: CyberGovernment`
  - `taskStore: ITaskStore`（12 个方法的完整接口）
  - `taskQueue: ITaskQueue`（Thunk 签名 `() => Promise<void>`）
  - `wsManager: IConnectionManager`
- 实现 `createApp(state)` 工厂函数
- JSON Body 限制 1MB 防 DoS
- 全局错误中间件：支持 `headersSent` 断流 + 400/500 区分 + FastAPI `detail` 对齐

### 2. `server/routes.ts` — REST API 端点

翻译 Python `routes.py` 的全部 6 个端点：

| 端点 | 方法 | 功能 | Python 对应 |
|------|------|------|------------|
| `/petition` | POST | 提交选民请愿 → 返回 `{ task_id, status, message }` | `submit_petition` |
| `/task/:id/status` | GET | 查询任务当前状态 | `get_task_status` |
| `/tasks` | GET | 分页查询历史任务列表（`?offset=0&limit=20`） | `list_tasks` |
| `/task/:id/act` | GET | 查询法案 JSON | `get_task_act` |
| `/task/:id/debate` | GET | 查询辩论记录 + Conflict Score 曲线 + Speaker 仲裁 | `get_task_debate` |
| `/task/:id/verdict` | GET | 查询司法判决详情 | `get_task_verdict` |

### 3. `server/schemas.ts` — Zod 请求/响应模型

将 Python `schemas.py`（Pydantic BaseModel）翻译为 Zod schema + TypeScript 类型：

- `PetitionRequestSchema` / `PetitionRequest`（含 `.trim().min(1)` 阻止空白）
- `PetitionResponseSchema` / `PetitionResponse`
- `TaskStatusResponseSchema` / `TaskStatusResponse`
- `TaskSummarySchema` / `TaskSummary`
- `TaskListResponseSchema` / `TaskListResponse`
- `ActResponseSchema` / `ActResponse`
- `DebateRoundSchema` / `DebateRound`（含 `speaker_intervention` 可选字段）
- `DebateResponseSchema` / `DebateResponse`
- `VerdictResponseSchema` / `VerdictResponse`

## 8 轮 QA 审查发现与修复摘要

| 轮次 | 发现数 | 致命级 | 关键修复项 |
|------|--------|--------|-----------|
| 1~2 | 4 | 0 | CORS `credentials` 冲突、`ITaskStore` 写入接口补齐、`JSON.parse` 裸调用保护 |
| 3 | 3 | 1 | **Promise 立即求值导致并发逃逸** → Thunk 改造；Error Middleware 吞噬 400；Body Size 限制 |
| 4 | 4 | 1 | **LLM 幻觉 `round_number:9999999` 导致 OOM 崩溃** → 上限 1000 + 丢弃；DB 数据类型伪装防御；JS `0||1` 隐式真值坑 |
| 5 | 1 | 0 | API 错误结构 `{detail}` 对齐 FastAPI 防止前端 undefined |
| 6 | 3 | 2 | **TCP Socket 幽灵挂起**（`headersSent` + `next(err)`）；CORS `methods:'*'` Safari 不兼容；Zod 空白绕过 `.trim()` |
| 7 | 2 | 1 | **分页 `total` 永远为 0** → `countTasks()` 接口遗漏；**Speaker 仲裁 UI 幽灵化** → Debate 解析器重构 |
| 8 | 3 | 1 | **`conflict_score=0` 被 `||` 吞噬** → `??` 空值合并；**状态机上下文劫持**（非法 Agent 混入 else 分支）；`null.length` 空引用爆炸 |

## 验收维度

- [x] `npm run build` 零 TypeScript 报错
- [x] `POST /petition` 返回 `202 Accepted` + `{ task_id, status, message }`
- [x] `GET /tasks` 返回 `{ total, offset, limit, tasks }` 含正确的 `total` 统计
- [x] 非法请求（缺少 `prompt`、纯空格、非 JSON、畸形 JSON）返回 `400 Bad Request`
- [x] 34 个单测覆盖全部 6 个端点的 Happy Path + 404 + 参数校验 + OOM 防御 + 数据类型清洗 + Speaker 事件
- [x] 错误响应体同时包含 `error` 和 `detail` 字段，对齐 FastAPI 协议
- [x] CORS 配置兼容所有主流浏览器（显式 Methods 列表而非通配符）
- [x] 全局错误中间件正确处理 `headersSent` 场景，防止 TCP Socket 泄露
