# Task 2-C · PRD §4 完整事件映射 & Pipeline 事件埋点

> **对应 Phase 2 子项**：2.3 完整事件映射（PRD §4 全部 9 种事件类型）
> **前置依赖**：Task 2-B（WebSocket 推送通道就绪）
> **预估工作量**：1-2 会话
> **状态**：✅ 已完成

---

## 目标

将 PRD v3 §4 定义的全部 9 种事件类型在 Pipeline 各阶段正确触发和推送。确保 `wscat` 可收到从 `propose` 到 `constitutional`/`unconstitutional` 的完整事件流。这是通信层的"语义层"。

---

## 具体步骤

### Step 1：审查 & 完善事件模型

审查 `openclaw_republic/schemas/events.py` 中的事件模型，确保所有 9 种 PRD §4 事件 + `state_change` 事件有对应的模型支持：

| # | Action | 触发条件 | 需要的字段 | 当前状态 |
|---|--------|---------|-----------|---------|
| 1 | `propose` | 议员提出提案 | `emotion`, `text` | ✅ EventAction 有 |
| 2 | `brawl` | Conflict Score > 80 | `intensity` (0~10→归一化 0~1) | ✅ EventAction 有 |
| 3 | `order` | 议长控场 | `intensity` | ✅ EventAction 有 |
| 4 | `vote_passed` | 共识表决通过 | `ayes`, `nays` | ✅ VoteEvent 有 |
| 5 | `sign_act` | 总统签署 | — | ✅ EventAction 有 |
| 6 | `veto` | 总统否决 | `reason` | ✅ EventAction 有 |
| 7 | `tool_call` | 内阁调用 Skill | `skill`, 执行状态 | ✅ ExecutionEvent 有 |
| 8 | `constitutional` | 合宪判决 | — | ✅ JudgmentEvent 有 |
| 9 | `unconstitutional` | 违宪驳回 | `reason`, `traceback` | ✅ JudgmentEvent 有 |

根据需要补充/修正字段定义。

### Step 2：在 Pipeline 各节点埋入事件发布

修改 `openclaw_republic/government.py` 的 `_run_pipeline()` 方法，在每个关键节点发布对应事件：

```python
async def _run_pipeline(self, petition, lifecycle, bill_id):
    # 1. DRAFTING → DEBATING
    # → 发布 propose 事件（radical_mp 提案）
    await self._publish_event(EventAction.PROPOSE, "radical_mp", bill_id, ...)

    # 2. 辩论过程中
    # → 每轮辩论发布 DebateEvent（含 conflict_score）
    # → conflict_score > 80 时发布 brawl 事件
    # → 议长控场时发布 order 事件

    # 3. 表决通过
    # → 发布 vote_passed 事件

    # 4. 总统审查
    # → 签署时发布 sign_act 事件
    # → 否决时发布 veto 事件（含 reason）

    # 5. 行政执行
    # → 每个 Step 发布 tool_call 事件（含 skill 名称和状态）

    # 6. 司法审查
    # → 合宪发布 constitutional 事件
    # → 违宪发布 unconstitutional 事件（含 reason + traceback）
```

### Step 3：修改辩论引擎发布细粒度事件

修改 `openclaw_republic/agents/legislative/debate.py` 或在 `Speaker.moderate_debate()` 中注入事件发布回调：

```python
# 方案 A：在 Speaker 中注入 event_publisher 回调
class Speaker:
    async def moderate_debate(
        self, radical, conservative, config,
        event_publisher: Callable | None = None,
    ):
        for round_num in range(config.max_rounds):
            # 激进派发言
            proposal = await radical.propose(...)
            if event_publisher:
                await event_publisher(EventAction.PROPOSE, "radical_mp", ...)

            # 保守派 critique
            critique = await conservative.critique(...)
            if event_publisher:
                await event_publisher(EventAction.PROPOSE, "conservative_mp", ...)

            # Conflict Score
            score = compute_conflict_score(...)
            if score > config.conflict_threshold:
                if event_publisher:
                    await event_publisher(EventAction.BRAWL, "speaker", ...)
                    await event_publisher(EventAction.ORDER, "speaker", ...)

# 方案 B：通过 MessageBus 直接发布（耦合度更低）
# → Government 层在 moderate_debate 前注册辩论事件处理器
```

### Step 4：修改执行引擎发布工具调用事件

修改 `ExecutionEngine.execute_act()` 在每步执行前/后发布 `tool_call` 事件：

```python
# 在 government._run_pipeline() 中包装执行引擎
for step_index, step in enumerate(act.steps):
    # 发布 tool_call 开始
    await self._publish_tool_call(bill_id, step.skill, step_index, "running")

    result = await engine.execute_step(step)

    # 发布 tool_call 完成/失败
    status = "success" if result.success else "failed"
    await self._publish_tool_call(bill_id, step.skill, step_index, status)
```

### Step 5：实现事件发布辅助方法

在 `CyberGovernment` 中添加每种事件的辅助发布方法：

```python
async def _publish_propose(self, bill_id, agent, text, emotion):
    event = DebateEvent(
        source_agent=agent,
        action=EventAction.PROPOSE,
        emotion=emotion,
        statement=text,
        task_id=bill_id,
        round_number=...,
        conflict_score=...,
    )
    await self.bus.publish("legislation", event)

async def _publish_brawl(self, bill_id, intensity):
    ...

async def _publish_tool_call(self, bill_id, skill, step_index, status):
    event = ExecutionEvent(
        source_agent="sec_engineering",
        action=EventAction.TOOL_CALL,
        tool_name=skill,
        step_index=step_index,
        status=status,
        task_id=bill_id,
    )
    await self.bus.publish("execution", event)
```

### Step 6：编写测试

```
tests/
├── unit/
│   └── test_event_mapping.py      # 每种事件类型的构造和序列化验证
└── integration/
    └── test_full_event_stream.py  # 完整 Pipeline 中所有 9 种事件均被发布
```

**测试要点**：
- 构造每种事件类型并验证 `model_dump(mode="json")` 输出
- Mock Pipeline 端到端跑通，验证事件日志中包含所有 9 种 `EventAction`
- `brawl` 事件仅在 conflict_score > 阈值时发布
- `veto` 事件包含 `reason` 字段
- `unconstitutional` 事件包含 `reason` 和 `evidence`
- `tool_call` 事件包含 `skill` 和 `status` 字段
- 事件序列按时间顺序正确（propose 在 vote_passed 之前等）

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/schemas/events.py` | 审查/补充字段（更新） |
| `openclaw_republic/government.py` | Pipeline 各节点事件埋点（更新） |
| `openclaw_republic/agents/legislative/speaker.py` | 辩论事件发布回调（更新） |
| `openclaw_republic/agents/executive/engine.py` | 执行事件发布（更新） |
| `tests/unit/test_event_mapping.py` | 事件映射单测 |
| `tests/integration/test_full_event_stream.py` | 全事件流集成测试 |

---

## 验收标准

- [x] Pipeline 运行中，EventLogger 记录到所有 9 种 `EventAction` 类型
- [x] `wscat` 连接后可收到 `propose` → `brawl`(可选) → `order`(可选) → `vote_passed` → `sign_act` → `tool_call` → `constitutional` 的完整事件流
- [x] `veto` 流程中可收到 `veto` 事件（含 `reason`）
- [x] `unconstitutional` 流程中可收到 `unconstitutional` 事件（含 `reason` + `evidence`）
- [x] 每种事件的 JSON 格式与 PRD §4 表格对齐
- [x] 所有单测、集成测试通过
- [x] `mypy --strict` 0 errors，`ruff check` 0 warnings

---

## 不包含（由后续 Task 处理）

- ❌ 历史事件回放 API（→ Task 2-D）
- ❌ Conflict Score 曲线数据聚合（→ Task 2-D）
- ❌ 前端动画触发逻辑（→ Phase 3）

---

## 后续衔接

- ← 前置：[Task 2-B · WebSocket 实时事件流](task2.2_websocket_events.md)
- → 后续：[Task 2-D · REST 查询 API & 并发控制](task2.4_rest_query_and_concurrency.md)
