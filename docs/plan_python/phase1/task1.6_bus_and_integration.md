# Task 1-F · 协作总线 & 端到端集成

> **对应 Phase 1 子项**：1.5 三权协作总线（消息总线 + 状态机 + 事件日志）+ 端到端集成验证
> **前置依赖**：Task 1-E（司法分支 — 三权 Agent 均已实现）
> **预估工作量**：1-2 个会话
> **状态**：✅ 已完成

---

## 目标

实现三权分支之间的异步消息传递协议和法案生命周期状态机，将立法、行政、司法三个分支串联为完整 Pipeline。最终验收：一次 CLI 端到端 demo 跑通全流程。

---

## 具体步骤

### Step 1：实现消息总线

替换当前占位的 `openclaw_republic/bus/message_bus.py`：

```python
class MessageBus:
    """三权协作消息总线。

    初期基于 asyncio.Queue 实现内存队列，
    后续可无缝切换为 Redis Streams / NATS。
    """

    def __init__(self) -> None:
        self._topics: dict[str, asyncio.Queue] = {}
        self._subscribers: dict[str, list[Callable]] = {}
        self._event_log: list[BaseEvent] = []

    # ─── 发布/订阅 ─────────────────────────

    async def publish(self, topic: str, event: BaseEvent) -> None:
        """发布事件到指定主题。"""
        ...

    def subscribe(self, topic: str, handler: Callable) -> None:
        """订阅指定主题。"""
        ...

    async def start(self) -> None:
        """启动消息分发循环。"""
        ...

    async def stop(self) -> None:
        """优雅停止总线。"""
        ...

    # ─── 主题定义 ───────────────────────────

    TOPICS = {
        "legislation": ...,   # 立法分支事件
        "execution": ...,     # 行政分支事件
        "judiciary": ...,     # 司法分支事件
        "lifecycle": ...,     # 法案生命周期事件
    }
```

**消息路由规则**：
- 立法分支发布 `Act` → `legislation` 主题 → 行政分支（总统）订阅
- 行政分支发布执行事件 → `execution` 主题 → 司法分支（大法官）订阅
- 总统否决 → `legislation` 主题 → 立法分支订阅，触发重新起草
- 司法违宪判决 → `judiciary` 主题 → 行政分支停止 + 立法分支重新起草
- 所有状态变更 → `lifecycle` 主题 → 状态机消费

### Step 2：实现法案生命周期状态机

替换当前占位的 `openclaw_republic/bus/state_machine.py`：

```python
class BillState(str, Enum):
    PETITION = "petition"
    DRAFTING = "drafting"
    DEBATING = "debating"
    VOTED = "voted"
    SIGNED = "signed"
    VETOED = "vetoed"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    CONSTITUTIONAL = "constitutional"
    UNCONSTITUTIONAL = "unconstitutional"
    DELIVERED = "delivered"

# 合法状态转换定义
VALID_TRANSITIONS: dict[BillState, set[BillState]] = {
    BillState.PETITION: {BillState.DRAFTING},
    BillState.DRAFTING: {BillState.DEBATING},
    BillState.DEBATING: {BillState.VOTED},
    BillState.VOTED: {BillState.SIGNED, BillState.VETOED},
    BillState.SIGNED: {BillState.EXECUTING},
    BillState.VETOED: {BillState.DRAFTING},           # 回到起草
    BillState.EXECUTING: {BillState.REVIEWING},
    BillState.REVIEWING: {BillState.CONSTITUTIONAL, BillState.UNCONSTITUTIONAL},
    BillState.CONSTITUTIONAL: {BillState.DELIVERED},
    BillState.UNCONSTITUTIONAL: {BillState.DRAFTING}, # 回到起草
}

class BillLifecycle:
    """法案生命周期管理器。"""

    def __init__(self, bill_id: str) -> None:
        self.bill_id = bill_id
        self.current_state = BillState.PETITION
        self._history: list[StateTransition] = []

    def transition(self, to_state: BillState) -> None:
        """执行状态转换，非法转换抛异常。"""
        if to_state not in VALID_TRANSITIONS.get(self.current_state, set()):
            raise InvalidTransitionError(...)
        self._history.append(StateTransition(...))
        self.current_state = to_state

    @property
    def history(self) -> list[StateTransition]:
        return list(self._history)
```

### Step 3：实现结构化事件日志

在 `openclaw_republic/bus/` 下创建 `event_log.py`：

```python
class EventLogger:
    """结构化事件日志记录器。

    所有 Agent action 统一记录为结构化事件，
    含 emotion, intensity 等字段，
    直接对标 PRD §4 的 WebSocket 事件格式。
    """

    def __init__(self) -> None:
        self._events: list[BaseEvent] = []

    def log(self, event: BaseEvent) -> None:
        """记录一条事件。"""
        ...

    def get_events(
        self,
        source_agent: str | None = None,
        action: EventAction | None = None,
        since: datetime | None = None,
    ) -> list[BaseEvent]:
        """按条件查询事件。"""
        ...

    def export_for_websocket(self) -> list[dict]:
        """导出为 WebSocket 推送格式。"""
        ...
```

### Step 4：实现 CyberGovernment 顶层编排

实现 `openclaw_republic/government.py` 中的 `CyberGovernment`：

```python
class CyberGovernment:
    """三权分立 AI 协作政府的主入口。

    负责：
    1. 初始化三权分支的所有 Agent
    2. 创建并启动消息总线
    3. 注册各分支到消息总线
    4. 管理法案生命周期
    5. 提供外部 API（接收选民请愿）
    """

    def __init__(self, config_dir: Path) -> None:
        # 加载宪法
        self.constitution = load_constitution(config_dir / "constitution.yaml")
        # 加载 SOUL
        self.souls = load_all_souls(config_dir / "souls")
        # 初始化各分支 Agent
        self._init_legislative()
        self._init_executive()
        self._init_judicial()
        # 消息总线
        self.bus = MessageBus()
        self._register_subscribers()

    async def inaugurate(self, port: int = 8080) -> None:
        """启动三权协作系统。"""
        await self.bus.start()

    async def receive_petition(self, petition: str) -> str:
        """接收选民请愿，启动完整 Pipeline。

        Returns:
            最终交付结果或判决通知。
        """
        ...
```

### Step 5：实现 CLI 端到端 demo

创建 `scripts/demo_pipeline.py`：

```python
"""CLI Demo — 端到端 Pipeline 演示。

使用方式：
    .venv\Scripts\python.exe scripts/demo_pipeline.py "帮我写一个 Python 冒泡排序"
"""

async def main(petition: str) -> None:
    gov = CyberGovernment(config_dir=Path("config"))
    await gov.inaugurate()
    result = await gov.receive_petition(petition)
    print(result)
```

> **注意**：LLM 调用使用 Mock（或预设响应），确保 demo 不依赖真实 API Key 也能跑通。

### Step 6：编写单元测试和集成测试

```
tests/
├── unit/
│   ├── test_message_bus.py         # 消息总线单测
│   ├── test_state_machine.py       # 状态机单测
│   └── test_event_logger.py        # 事件日志单测
└── integration/
    └── test_pipeline.py            # 端到端 Pipeline 集成测试
```

**单测要点**：
- 消息发布后订阅者正确收到
- 无订阅者时消息不丢失（或按策略处理）
- 合法状态转换成功
- 非法状态转换抛出 `InvalidTransitionError`
- 状态历史正确记录
- 事件日志可按 Agent / Action / 时间查询
- 事件可导出为 WebSocket 格式

**集成测试要点**：
- 完整 Pipeline：Petition → Debate → Vote → Sign → Execute → Review → Deliver
- Veto 回路：法案被否决 → 回到 Drafting
- 违宪回路：执行结果违宪 → Kill → 回到 Drafting
- 状态机全程跟踪正确

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/bus/message_bus.py` | 消息总线（实现） |
| `openclaw_republic/bus/state_machine.py` | 法案生命周期状态机（实现） |
| `openclaw_republic/bus/event_log.py` | 结构化事件日志（新建） |
| `openclaw_republic/government.py` | CyberGovernment 主入口（实现） |
| `scripts/demo_pipeline.py` | CLI 端到端 demo（新建） |
| `tests/unit/test_message_bus.py` | 消息总线单测 |
| `tests/unit/test_state_machine.py` | 状态机单测 |
| `tests/unit/test_event_logger.py` | 事件日志单测 |
| `tests/integration/test_pipeline.py` | Pipeline 集成测试 |

---

## 验收标准

- [x] 消息总线可正常发布/订阅事件 — `test_subscriber_receives_event`, `test_multiple_subscribers`, `test_cross_topic_isolation`
- [x] 消息总线可优雅启动和停止 — `test_start_stop`, `test_bus_lifecycle`
- [x] 状态机覆盖所有合法状态转换 — `test_full_happy_path`, `test_all_states_have_entry`
- [x] 非法状态转换被正确拒绝 — `test_invalid_transition_raises`
- [x] Vetoed → Drafting 回路正确 — `test_veto_loop`, `test_veto_then_pass`
- [x] Unconstitutional → Drafting 回路正确 — `test_unconstitutional_loop`, `test_unconstitutional_then_pass`
- [x] 事件日志可结构化记录和查询 — `test_filter_by_source_agent`, `test_filter_by_action`, `test_filter_by_since`, `test_export_format`
- [x] `CyberGovernment` 可初始化三权所有 Agent — `test_government_class_exists`, 构造函数初始化 7 个 Agent
- [x] CLI demo 可端到端执行（Mock LLM）— `scripts/demo_pipeline.py` 输出「法案已交付」
- [x] 完整 Pipeline 集成测试通过 — `test_full_pipeline`, `test_veto_then_pass`, `test_unconstitutional_then_pass`, `test_max_retries_exhausted`
- [x] 所有单测通过 — 455 passed, mypy --strict 0 errors, ruff 0 warnings

---

## 不包含（由后续 Phase 处理）

- ❌ Redis / NATS 消息中间件适配（→ Phase 2 按需）
- ❌ FastAPI REST API（→ Phase 2）
- ❌ WebSocket 实时推送（→ Phase 2）
- ❌ 前端 UI（→ Phase 3）
- ❌ 真实 LLM API 接入（→ Phase 2 配置 API Key）

---

## 后续衔接

Task 1-F 完成后，Phase 1 全部完成 ✅

进入 → [Phase 2 · 通信桥接层](../phase2/phase2_overview.md)
