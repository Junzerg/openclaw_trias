# Task 2-A · FastAPI 应用骨架 & 核心 Petition API

> **对应 Phase 2 子项**：2.1 FastAPI 应用骨架 + 2.4.3 任务持久化（SQLite）
> **前置依赖**：Phase 1 全部完成（CyberGovernment.receive_petition() 可用）
> **预估工作量**：1 会话
> **状态**：✅ 完成

---

## 目标

搭建 FastAPI 应用骨架，实现核心提交请愿 API (`POST /petition`)，引入 SQLite 任务持久化，确保 `curl` 可提交 Petition 并触发后端 Pipeline。这是 Phase 2 的地基。

---

## 具体步骤

### Step 1：新增依赖

在 `pyproject.toml` 中添加 Phase 2 依赖：

```toml
[project.optional-dependencies]
server = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "websockets>=12.0",
    "aiosqlite>=0.20.0",
]
```

安装验证：`pip install -e ".[server]"`

### Step 2：实现 FastAPI 应用工厂

替换 `openclaw_republic/server/app.py` 占位代码：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

class AppState:
    """全局应用状态 — 持有 CyberGovernment 和 TaskStore。"""
    government: CyberGovernment
    task_store: TaskStore

@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 生命周期管理 — 启动/关闭 Government 和 DB。"""
    state = app.state
    await state.government.inaugurate()
    await state.task_store.initialize()
    yield
    await state.government.shutdown()
    await state.task_store.close()

def create_app(
    config_dir: Path = Path("config"),
    db_path: Path = Path("data/tasks.db"),
) -> FastAPI:
    """创建并配置 FastAPI 应用实例。"""
    app = FastAPI(
        title="OpenClaw Republic API",
        description="三权分立 AI 协作政府 — 通信桥接层",
        version="0.2.0",
        lifespan=lifespan,
    )
    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # 初始化 Government 和 TaskStore
    app.state.government = CyberGovernment(config_dir)
    app.state.task_store = TaskStore(db_path)
    # 注册路由
    register_routes(app)
    return app
```

### Step 3：实现 SQLite 任务持久化

新建 `openclaw_republic/server/task_store.py`：

```python
class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class TaskRecord(BaseModel):
    """任务记录。"""
    task_id: str
    petition: str
    status: TaskStatus
    result: str | None = None
    bill_state: str = "petition"
    created_at: datetime
    updated_at: datetime

class TaskStore:
    """SQLite 任务持久化存储。
    
    开发阶段使用 SQLite (aiosqlite)，后续可扩展 Redis。
    """
    
    async def initialize(self) -> None:
        """初始化数据库连接和表结构。"""
        ...
    
    async def create_task(self, task_id: str, petition: str) -> TaskRecord:
        """创建新任务记录。"""
        ...
    
    async def get_task(self, task_id: str) -> TaskRecord | None:
        """查询单个任务。"""
        ...
    
    async def update_task(self, task_id: str, **kwargs) -> None:
        """更新任务状态/结果。"""
        ...
    
    async def list_tasks(
        self, offset: int = 0, limit: int = 20
    ) -> list[TaskRecord]:
        """分页查询任务列表。"""
        ...
    
    async def close(self) -> None:
        """关闭数据库连接。"""
        ...
```

### Step 4：实现核心路由

替换 `openclaw_republic/server/routes.py` 占位代码：

```python
from fastapi import APIRouter

router = APIRouter()

# 请求/响应模型
class PetitionRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="选民请愿内容")

class PetitionResponse(BaseModel):
    task_id: str
    status: str
    message: str

class TaskStatusResponse(BaseModel):
    task_id: str
    petition: str
    status: str
    bill_state: str
    result: str | None
    created_at: datetime
    updated_at: datetime

# POST /petition — 提交请愿
@router.post("/petition", response_model=PetitionResponse)
async def submit_petition(req: PetitionRequest) -> PetitionResponse:
    """接收选民 Prompt，创建任务，后台触发三权状态机。"""
    task_id = str(uuid.uuid4())
    # 存储到 SQLite
    await task_store.create_task(task_id, req.prompt)
    # 后台启动 Pipeline (asyncio.create_task)
    asyncio.create_task(_run_petition(task_id, req.prompt))
    return PetitionResponse(
        task_id=task_id,
        status="pending",
        message="请愿已提交，三权状态机已启动",
    )

# GET /task/{task_id}/status — 查询任务状态
@router.get("/task/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str) -> TaskStatusResponse:
    """查询法案当前生命周期状态。"""
    ...
```

### Step 5：实现 uvicorn 启动脚本

新建 `scripts/run_server.py`：

```python
"""启动 OpenClaw Republic API 服务。

使用方式：
    python scripts/run_server.py
    # 或
    uvicorn openclaw_republic.server.app:create_app --factory --reload
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "openclaw_republic.server.app:create_app",
        factory=True,
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
```

### Step 6：编写单元测试

```
tests/
├── unit/
│   ├── test_task_store.py      # SQLite 持久化单测
│   └── test_server_app.py      # FastAPI 应用创建单测
└── integration/
    └── test_api_petition.py    # POST /petition + GET /status 集成测试
```

**测试要点**：
- TaskStore CRUD 操作正确（create / get / update / list / 分页）
- SQLite 初始化自动建表
- `create_app()` 返回可用的 FastAPI 实例
- `POST /petition` 返回 202 + task_id
- `GET /task/{id}/status` 返回正确状态
- 无效 task_id 返回 404
- Swagger 文档可访问 (`/docs`)

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `pyproject.toml` | 新增 `[server]` 可选依赖 |
| `openclaw_republic/server/app.py` | FastAPI 应用工厂（替换占位） |
| `openclaw_republic/server/routes.py` | REST 路由（替换占位） |
| `openclaw_republic/server/task_store.py` | SQLite 任务持久化（新建） |
| `openclaw_republic/server/__init__.py` | 更新导出 |
| `scripts/run_server.py` | uvicorn 启动脚本（新建） |
| `tests/unit/test_task_store.py` | TaskStore 单测 |
| `tests/unit/test_server_app.py` | FastAPI app 单测 |
| `tests/integration/test_api_petition.py` | Petition API 集成测试 |

---

## 验收标准

- [x] `pip install -e ".[server]"` 安装成功
- [x] `python scripts/run_server.py` 启动后 `/docs` 可访问 Swagger 文档
- [x] `curl -X POST http://localhost:8080/petition -H "Content-Type: application/json" -d '{"prompt":"写一个冒泡排序"}'` 返回 `task_id`
- [x] `curl http://localhost:8080/task/{task_id}/status` 返回任务状态
- [x] SQLite 数据库创建在 `data/tasks.db`，表结构正确
- [x] 所有单测、集成测试通过
- [x] `mypy --strict` 0 errors，`ruff check` 0 warnings

---

## 不包含（由后续 Task 处理）

- ❌ WebSocket 实时事件推送（→ Task 2-B）
- ❌ 完整 PRD §4 事件映射（→ Task 2-C）
- ❌ 历史查询 REST API（→ Task 2-D）
- ❌ 并发控制 & 任务队列（→ Task 2-D）

---

## 后续衔接

- ← 前置：[Phase 1 · 后端核心](../phase1/phase1_overview.md)（全部 ✅）
- → 后续：[Task 2-B · WebSocket 实时事件流](task2.2_websocket_events.md)
