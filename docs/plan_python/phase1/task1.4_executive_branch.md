# Task 1-D · 行政分支

> **对应 Phase 1 子项**：1.3 行政分支全部（总统 + 工程部长 + 国务卿 + 执行引擎 + Veto 机制）
> **前置依赖**：Task 1-C（Conflict Score & 法案 Schema — 需要 `Act` 模型作为输入）
> **预估工作量**：1-2 个会话
> **状态**：✅ 已完成

---

## 目标

实现行政分支的完整链路：总统接收法案 → 校验签署/否决 → 拆解任务 → 内阁部长执行。完成后，行政分支可以接收一份《执行法案》并根据 Skill 可用性决定签署或否决，签署后由部长按步骤执行。

---

## 具体步骤

### Step 1：实现总统 Agent (President)

`openclaw_republic/agents/executive/president.py`

总统是行政分支的入口和决策者：
- 接收立法分支通过的《执行法案》(`Act`)
- 校验 Token 预算是否充足
- 校验各步骤所需 Skill 是否可用
- 决定：**签署 (Sign)** 或 **否决 (Veto)**
- 签署后将法案拆解为具体 Task，分派给内阁部长

```python
class President(BaseAgent):
    """总统 — 行政分支决策者。"""

    branch = Branch.EXECUTIVE
    permissions = {Permission.PLAN, Permission.VETO}

    async def review_act(self, act: Act) -> SignOrVeto:
        """审查法案，决定签署或否决。"""
        ...

    async def dispatch_tasks(self, act: Act) -> list[Task]:
        """将签署后的法案拆解为任务，分派内阁。"""
        ...
```

### Step 2：实现 Veto 机制

当以下条件满足时，总统否决法案：
- 法案总 Token 预算超出宪法限制
- 某步骤所需 Skill 在内阁中不可用
- LLM 判断法案可行性不足（可选，预留接口）

否决操作：
- 生成 `VetoNotice`（含否决理由）
- 打回立法分支重新起草
- 发出 `VETO` 事件

```python
class VetoNotice(BaseModel):
    """否决通知 — 总统打回法案的理由。"""
    act_id: str
    reason: str
    specific_issues: list[str]
    suggestion: str | None = None  # 修改建议
```

### Step 3：实现工程部长 Agent (Sec. of Engineering)

`openclaw_republic/agents/executive/sec_engineering.py`

- 挂载 Skills：`CodeExecution`, `Python_Interpreter`, `GitHub`
- 负责实际编码与环境操作
- 只响应总统分派的 Task

```python
class SecEngineering(BaseAgent):
    """工程部长 — 编码执行与工程操作。"""

    branch = Branch.EXECUTIVE
    permissions = {Permission.EXECUTE}
    _available_tools = ["CodeExecution", "Python_Interpreter", "GitHub"]

    async def execute_task(self, task: ExecutionTask) -> TaskResult:
        """执行总统分派的编码任务。"""
        ...
```

### Step 4：实现国务卿 Agent (Sec. of State)

`openclaw_republic/agents/executive/sec_state.py`

- 挂载 Skills：`WebBrowser`, `Search`
- 负责外部信息检索与 API 交互
- 只响应总统分派的 Task

```python
class SecState(BaseAgent):
    """国务卿 — 外部信息检索与交互。"""

    branch = Branch.EXECUTIVE
    permissions = {Permission.EXECUTE}
    _available_tools = ["WebBrowser", "Search"]

    async def execute_task(self, task: ExecutionTask) -> TaskResult:
        """执行总统分派的检索任务。"""
        ...
```

### Step 5：实现执行引擎

在 `openclaw_republic/agents/executive/` 下创建 `engine.py`：

```python
class ExecutionEngine:
    """行政执行引擎 — 管理法案步骤的顺序/并行执行。"""

    def __init__(self, cabinet: dict[str, BaseAgent]) -> None:
        """
        Args:
            cabinet: {skill_name: agent} 映射，如
                     {"CodeExecution": sec_engineering, "Search": sec_state}
        """
        ...

    async def execute_act(self, act: Act) -> ExecutionReport:
        """按法案步骤列表执行。

        处理逻辑：
        1. 按步骤依赖关系确定执行顺序
        2. 无依赖的步骤可并行执行
        3. 跟踪 Token 消耗
        4. 收集各步骤执行结果
        5. 生成执行报告
        """
        ...

    def resolve_skill(self, skill_name: str) -> BaseAgent | None:
        """根据 Skill 名查找对应的内阁部长。"""
        ...
```

**执行报告模型**：

```python
class TaskResult(BaseModel):
    step_index: int
    status: Literal["success", "failed", "skipped"]
    output: str
    tokens_consumed: int
    error: str | None = None

class ExecutionReport(BaseModel):
    act_id: str
    overall_status: Literal["completed", "partial", "failed"]
    task_results: list[TaskResult]
    total_tokens_consumed: int
    execution_time_seconds: float
```

### Step 6：编写单元测试

```
tests/unit/
├── test_president.py           # 总统 Agent 测试
├── test_veto.py                # Veto 机制测试
├── test_sec_engineering.py     # 工程部长测试
├── test_sec_state.py           # 国务卿测试
└── test_execution_engine.py    # 执行引擎测试
```

**测试要点**：
- 总统权限为 `{PLAN, VETO}`，无 EXECUTE/KILL
- Skill 可用时总统签署法案
- Skill 不可用时总统否决法案并附理由
- Token 超限时总统否决法案
- 否决通知包含具体问题和修改建议
- 工程部长只能调用 CodeExecution/Python_Interpreter/GitHub
- 国务卿只能调用 WebBrowser/Search
- 执行引擎按依赖关系分派任务
- 执行引擎生成完整的 `ExecutionReport`

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/agents/executive/president.py` | 总统 Agent（实现） |
| `openclaw_republic/agents/executive/sec_engineering.py` | 工程部长 Agent（实现） |
| `openclaw_republic/agents/executive/sec_state.py` | 国务卿 Agent（实现） |
| `openclaw_republic/agents/executive/engine.py` | 执行引擎（新建） |
| `openclaw_republic/schemas/act.py` | VetoNotice 等补充模型 |
| `openclaw_republic/agents/executive/__init__.py` | 导出更新 |
| `tests/unit/test_president.py` | 总统单测 |
| `tests/unit/test_veto.py` | Veto 单测 |
| `tests/unit/test_sec_engineering.py` | 工程部长单测 |
| `tests/unit/test_sec_state.py` | 国务卿单测 |
| `tests/unit/test_execution_engine.py` | 执行引擎单测 |

---

## 验收标准

- [x] 总统可根据 Token 预算和 Skill 可用性决定签署/否决
- [x] Veto 机制正确触发并生成包含理由的否决通知
- [x] 工程部长和国务卿各自只能使用挂载的 Skill
- [x] 执行引擎可按法案步骤顺序执行（Mock 工具调用）
- [x] 执行引擎正确处理步骤依赖关系
- [x] 执行报告包含各步骤结果和 Token 消耗统计
- [x] RBAC 校验：行政 Agent 无法执行 PLAN 操作（总统除外）
- [x] 所有单测通过（84 新测试，全量 318 passed）

---

## 不包含（由其他 Task 处理）

- ❌ 真实工具调用（CodeExecution/Search 等的实际实现）（→ Phase 2+）
- ❌ 司法审查对执行过程的监听（→ Task 1-E）
- ❌ 消息总线集成（→ Task 1-F）
- ❌ 否决后立法分支的重新起草流程（→ Task 1-F 集成时验证）

---

## 后续衔接

完成后进入 → [Task 1-E · 司法分支](task1.5_judicial_branch.md)
