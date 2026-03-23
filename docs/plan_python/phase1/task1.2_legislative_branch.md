# Task 1-B · 立法分支核心

> **对应 Phase 1 子项**：1.2.1 ~ 1.2.4（议长 + 激进派 + 保守派 + 辩论协议）
> **前置依赖**：Task 1-A（Agent 基类 & RBAC）
> **预估工作量**：1-2 个会话
> **状态**：✅ 已完成

---

## 目标

实现立法分支的三个核心 Agent（议长、激进派议员、保守派议员）和议会辩论协议引擎。完成后，三个 Agent 可以围绕一个"选民请愿"进行多轮辩论并达成共识。

---

## 具体步骤

### Step 1：实现议长 Agent (Speaker)

`openclaw_republic/agents/legislative/speaker.py`

议长负责流程编排：
- 接收选民请愿 (Petition)
- 发起提案阶段
- 分配辩论 Token 预算
- 控制辩论流程（多轮 Critique/Rebuttal）
- 判定终止条件（共识达成 / 轮次耗尽 / Token 预算用尽）
- 发起表决
- 汇总产出《执行法案》原始草案

```python
class Speaker(BaseAgent):
    """议长 — 立法分支流程编排器。"""

    branch = Branch.LEGISLATIVE
    permissions = {Permission.PLAN}

    async def receive_petition(self, petition: str) -> None:
        """接收选民请愿，启动立法流程。"""
        ...

    async def moderate_debate(self, ...) -> DebateResult:
        """控场：管理辩论轮次、判定终止条件。"""
        ...

    async def call_vote(self, ...) -> VoteResult:
        """发起表决。"""
        ...
```

### Step 2：实现激进派议员 Agent (Radical MP)

`openclaw_republic/agents/legislative/radical_mp.py`

- 通过 SOUL.md 注入极客/激进人设
- 偏好前沿技术栈、代码极简
- 在辩论中主动提出大胆方案
- 对保守派 Critique 进行 Rebuttal

```python
class RadicalMP(BaseAgent):
    """激进派议员 — 追求前沿技术与极简方案。"""

    branch = Branch.LEGISLATIVE
    permissions = {Permission.PLAN}

    async def propose(self, petition: str) -> str:
        """针对请愿生成提案。"""
        ...

    async def rebut(self, critique: str) -> str:
        """反驳保守派的批评。"""
        ...
```

### Step 3：实现保守派议员 Agent (Conservative MP)

`openclaw_republic/agents/legislative/conservative_mp.py`

- 通过 SOUL.md 注入防御性/保守人设（Red Team）
- 专挑性能瓶颈、内存泄漏、安全漏洞
- 在辩论中对激进派方案进行 Critique

```python
class ConservativeMP(BaseAgent):
    """保守派议员 — Red Team 思维，专挑漏洞。"""

    branch = Branch.LEGISLATIVE
    permissions = {Permission.PLAN}

    async def critique(self, proposal: str) -> str:
        """对提案进行批评审查。"""
        ...

    async def rebut(self, counter_argument: str) -> str:
        """针对反驳进行二次论证。"""
        ...
```

### Step 4：实现辩论协议引擎 (DebateEngine)

`openclaw_republic/agents/legislative/debate.py`

将当前占位的 `DebateEngine` 扩展为完整实现：

```
选民请愿 → 议长接收 → 分配预算
    → 激进派提案
    → 保守派 Critique
    → 激进派 Rebuttal
    → 计算 Conflict Score (委托 Task 1-C 的引擎)
    → 循环直到共识 / 轮次耗尽
    → 议长表决
    → 产出辩论结果
```

**关键设计**：
- 辩论循环管理（轮次计数、Token 预算消耗跟踪）
- 终止条件判定（共识阈值 / 最大轮次 / Token 耗尽）
- 产出 `DebateResult` 结构化结果

> **注意**：Conflict Score 的实际计算逻辑在 Task 1-C 中实现。此处先用 Mock/简单实现占位，确保辩论流程可跑通。

### Step 5：更新 `__init__.py` 导出

更新 `openclaw_republic/agents/legislative/__init__.py`，导出三个 Agent 类和 DebateEngine。

### Step 6：编写单元测试

```
tests/unit/
├── test_speaker.py           # 议长 Agent 测试
├── test_radical_mp.py        # 激进派测试
├── test_conservative_mp.py   # 保守派测试
└── test_debate_engine.py     # 辩论协议测试
```

**测试要点**：
- 三个 Agent 均继承 `BaseAgent`，权限为 `{PLAN}`
- 三个 Agent 均能加载对应的 SOUL.md
- RBAC 生效：三个 Agent 均不能调用 EXECUTE 级操作
- 辩论引擎可执行多轮辩论循环（使用 Mock LLM）
- 辩论在达到共识阈值或最大轮次时正确终止
- 辩论产出 `DebateResult` 包含各轮发言记录

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/agents/legislative/speaker.py` | 议长 Agent（实现） |
| `openclaw_republic/agents/legislative/radical_mp.py` | 激进派议员 Agent（实现） |
| `openclaw_republic/agents/legislative/conservative_mp.py` | 保守派议员 Agent（实现） |
| `openclaw_republic/agents/legislative/debate.py` | 辩论协议引擎（实现） |
| `openclaw_republic/agents/legislative/__init__.py` | 导出更新 |
| `tests/unit/test_speaker.py` | 议长单测 |
| `tests/unit/test_radical_mp.py` | 激进派单测 |
| `tests/unit/test_conservative_mp.py` | 保守派单测 |
| `tests/unit/test_debate_engine.py` | 辩论引擎单测 |

---

## 验收标准

- [x] `Speaker` 可接收请愿并启动辩论流程
- [x] `RadicalMP` 可生成提案和反驳
- [x] `ConservativeMP` 可生成批评和反论
- [x] 三个 Agent 均从 SOUL.md 加载了人设
- [x] 辩论引擎可跑通完整的多轮辩论循环（Mock LLM）
- [x] 辩论在终止条件满足时正确退出
- [x] RBAC 校验：立法 Agent 无法执行 EXECUTE 操作
- [x] 所有单测通过（174 tests, mypy --strict 0 errors, ruff 0 warnings）

---

## 不包含（由其他 Task 处理）

- ❌ Conflict Score 精确计算逻辑（→ Task 1-C，本 Task 用占位/简单实现）
- ❌ 《执行法案》JSON Schema 定义（→ Task 1-C）
- ❌ 行政分支（→ Task 1-D）
- ❌ 消息总线集成（→ Task 1-F）

---

## 后续衔接

完成后进入 → [Task 1-C · Conflict Score 引擎 & 法案 Schema](task1.3_conflict_score_and_act_schema.md)
