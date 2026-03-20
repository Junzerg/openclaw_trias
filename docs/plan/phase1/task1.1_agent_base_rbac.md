# Task 1-A · Agent 基类 & RBAC 权限模型

> **对应 Phase 1 子项**：1.1 Agent 基础框架 & RBAC
> **前置依赖**：Phase 0 全部完成（项目骨架、配置体系、SOUL.md、constitution.yaml 已就位）
> **预估工作量**：1 个会话
> **状态**：✅ 已完成

---

## 目标

实现所有 Agent 的公共基类，包括 SOUL.md 自动加载、LLM 调用接口、RBAC 权限声明与运行时校验、消息收发接口、生命周期管理。这是后续三个分支（立法、行政、司法）的基础。

---

## 具体步骤

### Step 1：定义权限枚举

在 `openclaw_republic/agents/base.py` 中，基于 `constitution.yaml` 的 RBAC 定义，创建 Python 枚举：

```python
from enum import Enum

class Permission(str, Enum):
    PLAN = "PLAN"           # 规划权 — 生成/修改方案
    EXECUTE = "EXECUTE"     # 执行权 — 调用底层工具
    MONITOR = "MONITOR"     # 监控权 — 只读监听
    VETO = "VETO"           # 否决权 — 打回法案
    KILL = "KILL"           # 熔断权 — 强制终止

class Branch(str, Enum):
    LEGISLATIVE = "legislative"
    EXECUTIVE = "executive"
    JUDICIAL = "judicial"
```

### Step 2：实现 RBAC 权限校验

```python
class PermissionDeniedError(Exception):
    """权限不足时抛出。"""

class RBACMixin:
    """RBAC 权限校验混入类。"""

    def __init_rbac__(self, permissions: set[Permission]) -> None:
        self._permissions = frozenset(permissions)

    def has_permission(self, perm: Permission) -> bool:
        return perm in self._permissions

    def require_permission(self, perm: Permission) -> None:
        if not self.has_permission(perm):
            raise PermissionDeniedError(
                f"{self.role} 不具备 {perm.value} 权限"
            )
```

### Step 3：扩展 BaseAgent 基类

将当前占位的 `BaseAgent` 扩展为完整实现：

```python
class BaseAgent:
    def __init__(
        self,
        name: str,
        role: str,
        branch: Branch,
        permissions: set[Permission],
        soul_path: Path | None = None,
    ) -> None:
        # 基本身份
        self.name = name
        self.role = role
        self.branch = branch

        # RBAC
        self._permissions = frozenset(permissions)

        # SOUL.md 加载
        self.system_prompt: str = ""
        if soul_path:
            self._load_soul(soul_path)

    def _load_soul(self, path: Path) -> None:
        """从 SOUL.md 加载 System Prompt。"""
        ...

    def has_permission(self, perm: Permission) -> bool: ...
    def require_permission(self, perm: Permission) -> None: ...

    async def act(self, message: AgentMessage) -> AgentMessage:
        """核心处理循环 — 子类必须实现。"""
        raise NotImplementedError

    async def receive(self, message: AgentMessage) -> None:
        """接收消息入口 — 包含权限校验。"""
        ...

    def emit_event(self, action: EventAction, **kwargs) -> BaseEvent:
        """生成结构化事件。"""
        ...
```

### Step 4：定义 Agent 消息模型

在 `openclaw_republic/schemas/` 中创建 `messages.py`：

```python
class AgentMessage(BaseModel):
    """Agent 间通信的标准消息格式。"""
    sender: str
    receiver: str | None = None
    content: str
    message_type: MessageType
    metadata: dict[str, Any] = {}
    timestamp: datetime = Field(default_factory=datetime.now)

class MessageType(str, Enum):
    PETITION = "petition"         # 选民请愿
    PROPOSAL = "proposal"         # 提案
    CRITIQUE = "critique"         # 批评
    REBUTTAL = "rebuttal"         # 反驳
    VOTE = "vote"                 # 投票
    ACT = "act"                   # 法案
    VETO_NOTICE = "veto_notice"   # 否决通知
    EXECUTION_RESULT = "execution_result"
    JUDGMENT = "judgment"         # 判决
    SYSTEM = "system"             # 系统消息
```

### Step 5：实现 SOUL.md 加载引擎增强

增强 `config/loader.py` 中的 SOUL.md 加载，支持：
- 从 SOUL.md 中提取 `## System Prompt` 段落作为 LLM System Message
- 缓存已加载的 SOUL（避免重复 IO）
- 支持热更新接口（预留，后续实现 file watcher）

### Step 6：Workspace 物理隔离设计

在 `BaseAgent` 中定义工具注册机制，为后续分支实现做准备：

```python
class BaseAgent:
    # ...
    _available_tools: list[str] = []  # 子类声明可用工具

    def register_tools(self, tools: list[str]) -> None:
        """注册此 Agent 可用的工具集。"""
        ...

    def can_use_tool(self, tool_name: str) -> bool:
        """检查此 Agent 是否有权使用指定工具。"""
        ...
```

### Step 7：编写单元测试

```
tests/unit/
├── test_base_agent.py       # BaseAgent 基类测试
├── test_rbac.py             # RBAC 权限校验测试
└── test_messages.py         # 消息模型测试
```

**测试要点**：
- 各角色的权限声明正确（立法 Agent 有 PLAN，无 EXECUTE 等）
- `require_permission()` 对非法操作抛出 `PermissionDeniedError`
- SOUL.md 自动加载后 `system_prompt` 不为空
- `AgentMessage` 可正常序列化/反序列化
- 工具隔离：立法 Agent 无法使用 `CodeExecution` 工具

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/agents/base.py` | Agent 基类（完整实现） |
| `openclaw_republic/schemas/messages.py` | Agent 消息模型（新建） |
| `openclaw_republic/config/loader.py` | SOUL.md 加载引擎（增强） |
| `tests/unit/test_base_agent.py` | 基类单测 |
| `tests/unit/test_rbac.py` | RBAC 单测 |
| `tests/unit/test_messages.py` | 消息模型单测 |

---

## 验收标准

- [x] `Permission` 枚举包含 PLAN/EXECUTE/MONITOR/VETO/KILL 五种权限
- [x] `BaseAgent` 可通过 `soul_path` 自动加载 SOUL.md 内容
- [x] 权限校验生效：立法 Agent 调用 `require_permission(EXECUTE)` 抛异常
- [x] 权限校验生效：行政 Agent 调用 `require_permission(PLAN)` 抛异常
- [x] `AgentMessage` Pydantic 模型序列化/反序列化正常
- [x] 工具注册机制可声明并校验可用工具
- [x] 所有单测通过

---

## 不包含（由后续 Task 处理）

- ❌ 具体 Agent 实现（Speaker/MP 等）（→ Task 1-B）
- ❌ LLM 实际调用逻辑（→ 各分支 Task 实现时接入）
- ❌ 消息总线的路由/发布（→ Task 1-F）
- ❌ 辩论协议（→ Task 1-B）

---

## 后续衔接

完成后进入 → [Task 1-B · 立法分支核心](task1.2_legislative_branch.md)
