# Task 2-D · REST 查询 API & 并发控制

> **对应 Phase 2 子项**：2.4.1~2.4.2 任务队列 & 并发控制 + 2.5 REST 查询 API
> **前置依赖**：Task 2-C（事件映射完成，事件数据已持久化）
> **预估工作量**：1 会话
> **状态**：⬜ 未开始

---

## 目标

实现完整的 REST 查询 API（历史任务列表、法案详情、辩论记录、审判结果），引入异步任务队列和并发控制机制，防止多个重任务同时竞争资源。

---

## 具体步骤

### Step 1：实现任务队列 & 并发控制

新建 `openclaw_republic/server/task_queue.py`：

```python
class TaskQueue:
    """异步任务调度器。
    
    控制同时运行的 Pipeline 数量，防止多任务竞争
    LLM Token 预算和系统资源。
    """
    
    def __init__(self, max_concurrent: int = 1) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._pending: asyncio.Queue[TaskEntry] = asyncio.Queue()
        self._running: dict[str, asyncio.Task] = {}
    
    async def submit(
        self,
        task_id: str,
        coro: Coroutine,
    ) -> None:
        """提交任务到队列。
        
        如果并发数未满，立即执行；否则排队等待。
        """
        ...
    
    async def cancel(self, task_id: str) -> bool:
        """取消尚未完成的任务。"""
        ...
    
    @property
    def running_count(self) -> int:
        """当前正在执行的任务数。"""
        ...
    
    @property
    def pending_count(self) -> int:
        """等待执行的任务数。"""
        ...
```

### Step 2：扩展 TaskStore 存储辩论和执行数据

扩展 SQLite 表结构以支持查询辩论记录、法案内容、审判结果：

```sql
-- tasks 主表（Task 2-A 已创建）
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    petition TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    bill_state TEXT DEFAULT 'petition',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 事件日志表（新增）
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    action TEXT NOT NULL,
    emotion TEXT DEFAULT 'neutral',
    intensity REAL DEFAULT 0.5,
    payload TEXT DEFAULT '{}',  -- JSON
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);

-- 法案表（新增）
CREATE TABLE acts (
    task_id TEXT PRIMARY KEY,
    act_json TEXT NOT NULL,  -- 完整法案 JSON
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);

-- 判决表（新增）
CREATE TABLE verdicts (
    task_id TEXT PRIMARY KEY,
    constitutional BOOLEAN NOT NULL,
    ruling TEXT NOT NULL,
    evidence TEXT DEFAULT '[]',  -- JSON array
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);
```

### Step 3：实现 REST 查询路由

在 `openclaw_republic/server/routes.py` 中添加查询 API：

```python
# GET /tasks — 历史任务列表（分页）
@router.get("/tasks")
async def list_tasks(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> TaskListResponse:
    """分页查询历史任务。"""
    ...

# GET /task/{task_id}/act — 法案详情
@router.get("/task/{task_id}/act")
async def get_task_act(task_id: str) -> ActResponse:
    """查看法案 JSON 内容。"""
    ...

# GET /task/{task_id}/debate — 辩论记录
@router.get("/task/{task_id}/debate")
async def get_task_debate(task_id: str) -> DebateResponse:
    """查询辩论日志 + Conflict Score 曲线数据。"""
    ...

# GET /task/{task_id}/verdict — 审判结果
@router.get("/task/{task_id}/verdict")
async def get_task_verdict(task_id: str) -> VerdictResponse:
    """查询司法判决详情。"""
    ...
```

### Step 4：定义响应模型

```python
class TaskListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    tasks: list[TaskSummary]

class TaskSummary(BaseModel):
    task_id: str
    petition: str  # 截取前 100 字符
    status: str
    bill_state: str
    created_at: datetime

class ActResponse(BaseModel):
    task_id: str
    act: dict  # 完整法案 JSON
    created_at: datetime

class DebateResponse(BaseModel):
    task_id: str
    rounds: list[DebateRound]
    conflict_score_curve: list[float]  # 每轮分歧度

class DebateRound(BaseModel):
    round_number: int
    radical_statement: str
    conservative_statement: str
    conflict_score: float

class VerdictResponse(BaseModel):
    task_id: str
    constitutional: bool
    ruling: str
    evidence: list[str]
    created_at: datetime
```

### Step 5：在 Pipeline 中持久化辩论/法案/判决数据

修改 `_run_pipeline()` 在关键节点存储数据到 SQLite：

```python
# 辩论结束后 → 存储辩论记录
await self._store_debate_log(bill_id, debate_result)

# 法案生成后 → 存储法案 JSON
await self._store_act(bill_id, act)

# 判决后 → 存储判决结果
await self._store_verdict(bill_id, verdict)

# 同时每个事件也持久化到 events 表
```

### Step 6：将 TaskQueue 集成到 app 中

修改 `app.py` 和 `routes.py`，使用 TaskQueue 管理 Pipeline 执行：

```python
# POST /petition 中
@router.post("/petition")
async def submit_petition(req: PetitionRequest):
    task_id = str(uuid.uuid4())
    await task_store.create_task(task_id, req.prompt)
    # 通过 TaskQueue 提交，而非直接 create_task
    await task_queue.submit(
        task_id,
        _run_petition(task_id, req.prompt),
    )
    return PetitionResponse(
        task_id=task_id,
        status="pending",
        message="请愿已提交",
    )
```

### Step 7：编写测试

```
tests/
├── unit/
│   ├── test_task_queue.py         # 任务队列 & 并发控制
│   └── test_rest_queries.py       # REST 查询 API 单测
└── integration/
    └── test_query_after_pipeline.py  # Pipeline 完成后查询各项数据
```

**测试要点**：
- TaskQueue 并发控制（max_concurrent=1 时第二个任务排队等待）
- TaskQueue 任务取消
- `GET /tasks` 分页正确
- `GET /task/{id}/act` 返回法案 JSON
- `GET /task/{id}/debate` 返回辩论记录和 Conflict Score 曲线
- `GET /task/{id}/verdict` 返回判决详情
- 无效 task_id 返回 404
- Pipeline 完成后所有数据可查

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/server/task_queue.py` | 异步任务队列（新建） |
| `openclaw_republic/server/task_store.py` | 扩展 SQLite 表结构（更新） |
| `openclaw_republic/server/routes.py` | 添加查询路由（更新） |
| `openclaw_republic/server/schemas.py` | 响应模型定义（新建） |
| `openclaw_republic/government.py` | Pipeline 中持久化数据（更新） |
| `tests/unit/test_task_queue.py` | 任务队列单测 |
| `tests/unit/test_rest_queries.py` | REST 查询 API 单测 |
| `tests/integration/test_query_after_pipeline.py` | 查询数据集成测试 |

---

## 验收标准

- [ ] `curl http://localhost:8080/tasks` 返回分页任务列表
- [ ] `curl http://localhost:8080/task/{id}/act` 返回法案 JSON
- [ ] `curl http://localhost:8080/task/{id}/debate` 返回辩论记录（含 Conflict Score 曲线数据）
- [ ] `curl http://localhost:8080/task/{id}/verdict` 返回判决详情
- [ ] 并发提交多个 Petition 时，只有 1 个 Pipeline 在执行（并发控制生效）
- [ ] 第二个任务在第一个完成后自动执行
- [ ] 所有单测、集成测试通过
- [ ] `mypy --strict` 0 errors，`ruff check` 0 warnings

---

## 不包含（由后续处理）

- ❌ Redis 持久化适配（→ Phase 4 按需）
- ❌ 连接级别认证（→ Phase 4）
- ❌ 前端 UI（→ Phase 3）

---

## 后续衔接

- ← 前置：[Task 2-C · PRD §4 完整事件映射](task2.3_event_mapping.md)
- → 后续：Phase 2 全部完成 ✅，进入 [Phase 3 · 像素演播厅前端](../phase3/phase3_overview.md)
