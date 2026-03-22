# Task 1-E · 司法分支

> **对应 Phase 1 子项**：1.4 司法分支全部（首席大法官 + 违宪规则引擎 + 过程/结果审查 + 物理熔断）
> **前置依赖**：Task 1-D（行政分支 — 需要执行引擎产出，才有审查对象）
> **预估工作量**：1-2 个会话
> **状态**：✅ 已完成

---

## 目标

实现司法分支的完整审查能力：首席大法官旁路监听行政行为，违宪规则引擎基于 `constitution.yaml` 进行过程审查和结果审查，违宪时触发物理熔断（Kill Switch）并生成判决书。

---

## 具体步骤

### Step 1：实现首席大法官 Agent (Chief Justice)

`openclaw_republic/agents/judicial/chief_justice.py`

首席大法官的职责：
- 旁路监听行政分支的所有动作（MONITOR 权限）
- 调度过程审查和结果审查
- 做出最终合宪/违宪判决
- 违宪时触发 Kill Switch

```python
class ChiefJustice(BaseAgent):
    """首席大法官 — 最高安全审查权威。"""

    branch = Branch.JUDICIAL
    permissions = {Permission.MONITOR, Permission.KILL}

    async def monitor_execution(self, event: ExecutionEvent) -> ReviewResult:
        """实时监听行政执行事件，触发过程审查。"""
        ...

    async def review_result(
        self,
        petition: str,
        execution_report: ExecutionReport,
    ) -> Verdict:
        """结果审查：比对原始请愿 vs 最终产出。"""
        ...

    async def issue_judgment(self, verdict: Verdict) -> JudgmentEvent:
        """发出判决并决定是否触发熔断。"""
        ...
```

### Step 2：实现违宪规则引擎

`openclaw_republic/agents/judicial/rules_engine.py`

从 `constitution.yaml` 加载规则集，提供两类审查：

```python
class RulesEngine:
    """违宪规则引擎 — 基于宪法进行自动化审查。"""

    def __init__(self, constitution: ConstitutionConfig) -> None:
        self._blacklist = constitution.judicial.blacklist_commands
        self._security = constitution.security
        self._deviation_max = constitution.judicial.deviation.max_score
        self._token_budget = constitution.judicial.token_budget
        ...

    # ─── 过程审查 (Process Review) ──────────────────

    def check_command(self, command: str) -> RuleCheckResult:
        """检测命令是否命中黑名单。"""
        ...

    def check_file_access(self, file_path: str) -> RuleCheckResult:
        """检测文件访问是否合规（扩展名白名单）。"""
        ...

    def check_resource_usage(
        self, tokens_consumed: int, execution_time: float
    ) -> RuleCheckResult:
        """检测资源使用是否超限。"""
        ...

    # ─── 结果审查 (Result Review) ───────────────────

    async def check_deviation(
        self, petition: str, output: str
    ) -> DeviationResult:
        """LLM-as-a-Judge 评估产出与请愿的偏离度。"""
        ...
```

**审查结果模型**：

```python
class RuleCheckResult(BaseModel):
    passed: bool
    rule_name: str
    violation_detail: str | None = None

class DeviationResult(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    passed: bool  # score <= max_score
    explanation: str
```

### Step 3：实现过程违宪审查 (Process Review)

实时沙箱监听机制：
1. **黑名单命令检测**：行政执行工具调用前/后，检查是否包含 `rm -rf`、`DROP TABLE` 等
2. **死循环检测**：同一操作重复执行超过阈值
3. **资源超限检测**：Token 消耗 / 执行时间超出宪法限制
4. **文件类型检测**：操作的文件扩展名是否在白名单

```python
class ProcessReviewer:
    """过程违宪审查 — 实时监听行政行为。"""

    def __init__(self, rules: RulesEngine) -> None:
        self._rules = rules
        self._action_history: list[str] = []
        self._loop_threshold: int = 5

    async def review_action(self, action: ExecutionEvent) -> ProcessReviewResult:
        """审查单个行政行为。"""
        results = []
        # 1. 检查命令黑名单
        # 2. 检查死循环
        # 3. 检查资源使用
        # 4. 检查文件访问
        ...

    def _detect_loop(self, action: str) -> bool:
        """检测是否出现死循环模式。"""
        ...
```

### Step 4：实现结果违宪审查 (Result Review)

交付验收机制：
- 比对《选民原始请愿》vs《最终产物》
- LLM-as-a-Judge 评估产出偏离度（0~1）
- 偏离度超过 `constitution.yaml` 中的 `deviation.max_score` 则判定违宪（幻觉检测）

```python
class ResultReviewer:
    """结果违宪审查 — 交付前验收。"""

    def __init__(self, rules: RulesEngine) -> None:
        self._rules = rules

    async def review_delivery(
        self,
        petition: str,
        execution_report: ExecutionReport,
    ) -> ResultReviewResult:
        """审查执行结果是否偏离原始请愿。"""
        ...
```

### Step 5：实现物理熔断机制 (Kill Switch)

违宪判定后的处置措施：

```python
class KillSwitch:
    """物理熔断 — 违宪判定后的强制终止与回滚。"""

    async def execute(self, verdict: Verdict) -> KillReport:
        """执行熔断：
        1. 强制 Kill 正在执行的容器/进程
        2. 回滚状态到执行前
        3. 生成判决书（含违宪理由 + Traceback）
        4. 通知立法分支重做
        """
        ...

class KillReport(BaseModel):
    verdict: Verdict
    killed_processes: list[str]
    rollback_success: bool
    judgment_document: str  # 完整判决书文本
```

### Step 6：重写 Verdict Schema

将当前占位的 `openclaw_republic/schemas/verdict.py` 替换为完整 Pydantic 模型：

```python
class Verdict(BaseModel):
    """司法判决 — 违宪审查的最终裁定。"""
    verdict_id: str
    act_id: str
    constitutional: bool
    ruling: str
    violation_type: ViolationType | None = None
    evidence: list[str] = []
    process_review: ProcessReviewResult | None = None
    result_review: ResultReviewResult | None = None
    remediation: str | None = None  # 补救建议
    created_at: datetime = Field(default_factory=datetime.now)

class ViolationType(str, Enum):
    BLACKLIST_COMMAND = "blacklist_command"
    RESOURCE_EXCEEDED = "resource_exceeded"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    FILE_ACCESS_VIOLATION = "file_access_violation"
    DEVIATION_EXCEEDED = "deviation_exceeded"
    INFINITE_LOOP = "infinite_loop"
```

### Step 7：编写单元测试

```
tests/unit/
├── test_chief_justice.py       # 首席大法官测试
├── test_rules_engine.py        # 违宪规则引擎测试
├── test_process_reviewer.py    # 过程审查测试
├── test_result_reviewer.py     # 结果审查测试
├── test_kill_switch.py         # 熔断机制测试
└── test_verdict_schema.py      # 判决 Schema 测试
```

**测试要点**：
- 大法官权限为 `{MONITOR, KILL}`，无 PLAN/EXECUTE
- 黑名单命令检测：`rm -rf` → 违宪，`ls` → 合宪
- 文件扩展名检测：`.py` → 合宪，`.exe` → 违宪
- Token 超限检测准确
- 死循环检测：同一操作重复 5 次 → 违宪
- 偏离度评估：Mock LLM 返回评分，超阈值 → 违宪
- 熔断触发后生成完整判决书
- `Verdict` 模型可序列化，`ViolationType` 枚举覆盖所有违宪类型

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/agents/judicial/chief_justice.py` | 首席大法官 Agent（实现） |
| `openclaw_republic/agents/judicial/rules_engine.py` | 违宪规则引擎（实现） |
| `openclaw_republic/agents/judicial/process_reviewer.py` | 过程审查器（新建） |
| `openclaw_republic/agents/judicial/result_reviewer.py` | 结果审查器（新建） |
| `openclaw_republic/agents/judicial/kill_switch.py` | 物理熔断（新建） |
| `openclaw_republic/schemas/verdict.py` | 判决 Schema（重写） |
| `openclaw_republic/agents/judicial/__init__.py` | 导出更新 |
| `tests/unit/test_chief_justice.py` | 大法官单测 |
| `tests/unit/test_rules_engine.py` | 规则引擎单测 |
| `tests/unit/test_process_reviewer.py` | 过程审查单测 |
| `tests/unit/test_result_reviewer.py` | 结果审查单测 |
| `tests/unit/test_kill_switch.py` | 熔断单测 |
| `tests/unit/test_verdict_schema.py` | 判决 Schema 单测 |

---

## 验收标准

- [x] 大法官可监听行政执行事件并触发审查
- [x] 黑名单命令检测正确（覆盖 `constitution.yaml` 中所有黑名单项）
- [x] 文件扩展名白名单校验生效
- [x] Token/时间资源超限可检测
- [x] 死循环模式可检测
- [x] 偏离度审查可对比请愿与产出（Mock LLM）
- [x] 违宪判定触发 Kill Switch，生成判决书
- [x] `Verdict` 模型完整序列化
- [x] RBAC 校验：大法官无法执行 PLAN/EXECUTE
- [x] 所有单测通过（82 tests, pytest 400/400, mypy 0 errors, ruff clean）

---

## 不包含（由其他 Task 处理）

- ❌ 消息总线上的实时事件监听集成（→ Task 1-F）
- ❌ 真实容器 Kill / 进程 Kill（本 Task 用 Mock）
- ❌ 判决后立法分支的自动重做流程（→ Task 1-F）

---

## 后续衔接

完成后进入 → [Task 1-F · 协作总线 & 端到端集成](task1.6_bus_and_integration.md)
