# Task 1-C · Conflict Score 引擎 & 《执行法案》Schema

> **对应 Phase 1 子项**：1.2.5 《执行法案》Schema + 1.2.6 Conflict Score 引擎
> **前置依赖**：Task 1-B（立法分支核心）
> **预估工作量**：1 个会话
> **状态**：✅ 已完成

---

## 目标

实现辩论分歧度量化引擎（Conflict Score）和《执行法案》的完整 JSON Schema 定义。Conflict Score 驱动辩论流程控制和前端动画分级；法案 Schema 是立法→行政交接的核心数据契约。

---

## 具体步骤

### Step 1：实现 Conflict Score 引擎

在 `openclaw_republic/agents/legislative/` 下创建 `conflict_score.py`：

```python
class ConflictScoreEngine:
    """辩论分歧度量化引擎。

    评分范围 0~100：
    - Lv1 (< 50)：温和讨论，前端显示平和动画
    - Lv2 (50~80)：激烈辩论，前端显示对抗动画
    - Lv3 (> 80)：严重分歧，议长需要控场
    """

    def compute(
        self,
        proposal: str,
        critique: str,
        rebuttal: str | None = None,
    ) -> ConflictScoreResult:
        """计算一轮辩论的分歧度。"""
        ...

    def compute_trend(self, history: list[float]) -> ConflictTrend:
        """计算分歧度趋势（用于判断是否收敛）。"""
        ...
```

**评分维度**（LLM-as-a-Judge 或规则混合）：
1. **立场对立度**：提案与批评的核心矛盾程度
2. **论点覆盖度**：是否回应了对方的关键论点
3. **妥协信号**：是否出现让步/折中的语言
4. **情绪强度**：用词激烈程度

**产出模型**：

```python
class ConflictScoreResult(BaseModel):
    score: float = Field(ge=0.0, le=100.0)
    level: Literal["Lv1", "Lv2", "Lv3"]
    dimensions: dict[str, float]  # 各维度细分
    explanation: str              # 评分理由摘要

class ConflictTrend(BaseModel):
    direction: Literal["converging", "diverging", "stable"]
    slope: float
    recent_scores: list[float]
```

### Step 2：将 Conflict Score 集成到辩论引擎

修改 Task 1-B 中的 `DebateEngine`，替换占位的 Conflict Score 计算：
- 每轮辩论后调用 `ConflictScoreEngine.compute()`
- 根据分数触发流程控制：
  - `< consensus_threshold`：共识达成，提前结束
  - `> conflict_threshold`：议长控场介入
  - 其他：继续下一轮

### Step 3：定义《执行法案》完整 JSON Schema

替换当前占位的 `openclaw_republic/schemas/act.py`，使用 Pydantic 定义完整法案模型：

```python
class ActStep(BaseModel):
    """法案中的单个执行步骤。"""
    index: int = Field(ge=0, description="步骤编号")
    description: str = Field(description="步骤描述")
    required_skill: str = Field(description="所需 Skill 名称")
    tool_parameters: dict[str, Any] = Field(default_factory=dict)
    estimated_tokens: int = Field(ge=0, description="预估 Token 消耗")
    acceptance_criteria: str = Field(description="验收标准")
    dependencies: list[int] = Field(default_factory=list, description="依赖的步骤编号")

class Act(BaseModel):
    """《执行法案》— 立法分支产出的结构化执行计划。

    这是立法→行政的核心交接物。总统根据此文档
    决定签署/否决，并拆解为具体任务派发内阁。
    """
    act_id: str = Field(description="法案唯一 ID")
    title: str = Field(description="法案标题")
    summary: str = Field(description="法案摘要")
    petition_origin: str = Field(description="原始选民请愿内容")
    steps: list[ActStep] = Field(min_length=1, description="执行步骤列表")
    total_estimated_tokens: int = Field(ge=0, description="总预估 Token")
    debate_record: DebateRecord = Field(description="辩论记录摘要")
    vote_record: VoteRecord = Field(description="表决记录")
    created_at: datetime = Field(default_factory=datetime.now)

class DebateRecord(BaseModel):
    """辩论记录摘要 — 嵌入法案中供行政分支参考。"""
    total_rounds: int
    final_conflict_score: float
    consensus_points: list[str]
    remaining_concerns: list[str]

class VoteRecord(BaseModel):
    """表决记录。"""
    ayes: int
    nays: int
    result: Literal["passed", "rejected"]
    voter_positions: dict[str, str]  # {角色名: "aye"/"nay"}
```

### Step 4：实现法案生成器

在 `DebateEngine` 或 `Speaker` 中添加法案生成逻辑：
- 辩论结束 + 表决通过后，将辩论共识转化为结构化 `Act`
- LLM 负责将自然语言共识提炼为 `ActStep` 列表

### Step 5：编写单元测试

```
tests/unit/
├── test_conflict_score.py     # Conflict Score 引擎测试
└── test_act_schema.py         # 法案 Schema 测试
```

**测试要点**：
- Conflict Score 评分落在 0~100 范围
- 分级正确：`< 50` → Lv1，`50~80` → Lv2，`> 80` → Lv3
- 趋势计算正确：连续下降 → converging，连续上升 → diverging
- `Act` 模型可完整创建并 JSON 序列化
- `ActStep` 约束生效（`index >= 0`，`estimated_tokens >= 0`）
- 法案必须至少有 1 个步骤（`min_length=1`）
- 法案可与辩论引擎产出的 `DebateResult` 正确对接

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `openclaw_republic/agents/legislative/conflict_score.py` | Conflict Score 引擎（新建） |
| `openclaw_republic/schemas/act.py` | 《执行法案》Schema（重写） |
| `openclaw_republic/agents/legislative/debate.py` | 辩论引擎（更新，集成 Conflict Score） |
| `tests/unit/test_conflict_score.py` | Conflict Score 单测 |
| `tests/unit/test_act_schema.py` | 法案 Schema 单测 |

---

## 验收标准

- [x] Conflict Score 可针对提案/批评/反驳文本输出 0~100 评分
- [x] 分级映射正确（Lv1/Lv2/Lv3）
- [x] 趋势分析可判断分歧度收敛/发散
- [x] `Act` Schema 可完整序列化为 JSON，字段约束有效
- [x] 辩论引擎已集成 Conflict Score，流程控制基于分数
- [x] 所有单测通过

---

## 不包含（由其他 Task 处理）

- ❌ 前端动画 Lv1/Lv2/Lv3 切换（→ Phase 3）
- ❌ 行政分支对法案的解析/执行（→ Task 1-D）
- ❌ 真实 LLM 调用（本 Task 可用 Mock 测试）

---

## 后续衔接

完成后进入 → [Task 1-D · 行政分支](task1.4_executive_branch.md)
