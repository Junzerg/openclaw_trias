# Task 0-B · 配置体系 & 数据模型

> **对应 Phase 0 子项**：0.3 SOUL.md 人设配置 + 0.4 宪法配置系统 + 0.5 日志 & 事件系统
> **前置依赖**：Task 0-A（项目骨架搭建）
> **预估工作量**：1-2 个会话（SOUL.md 创意写作需要斟酌）
> **状态**：✅ 已完成

---

## 目标

建立系统的"灵魂"与"宪法"——完成所有 Agent 的 SOUL.md 人设文件、全局宪法红线配置、以及贯穿全系统的结构化事件数据模型。

---

## 具体步骤

### Step 1：定义 SOUL.md 格式规范

在 `docs/` 或 `config/souls/` 下创建 `SOUL_TEMPLATE.md` 作为编写规范：

```markdown
# {角色名} — {官方称号}

## 人格特质
- 特质 1：...
- 特质 2：...
- 特质 3：...

## 职责边界
### ✅ 可以做
- ...

### ❌ 不可以做
- ...

## 输出风格
- 语气：...
- 用词习惯：...
- 特殊行为：...

## System Prompt
> 以下内容将在 Agent 初始化时注入 LLM 的 System Message。

{完整的 System Prompt 文本}
```

### Step 2：编写 7 个 SOUL.md 人设文件

在 `config/souls/` 目录下创建：

| 文件 | 角色 | 核心人设方向 |
|------|------|-------------|
| `speaker.md` | 🏛️ 议长 (Speaker of the House) | 中立裁判、流程控制大师、不偏不倚、掌控辩论节奏。像一个严格但公正的会议主持人 |
| `radical_mp.md` | 🔥 激进派议员 (Radical MP) | 技术极客、追求前沿、大胆创新、代码极简主义、喜欢 bleeding-edge 技术栈，偶尔过于乐观 |
| `conservative_mp.md` | 🛡️ 保守派议员 (Conservative MP) | Red Team 思维、防御性编程、专挑漏洞、安全第一、性能敏感、对新技术持怀疑态度 |
| `president.md` | 🎖️ 总统 (President) | 务实决策者、预算敏感、善于任务分派、关注 ROI、会行使否决权 |
| `sec_engineering.md` | ⚙️ 工程部长 (Sec. of Engineering) | 动手派、工程严谨、代码质量强迫症、测试覆盖率敏感、偏好可维护性 |
| `sec_state.md` | 🌐 国务卿 (Sec. of State) | 外交官气质、擅长信息检索与综合、善于跨域沟通、注重信息源可靠性 |
| `chief_justice.md` | ⚖️ 首席大法官 (Chief Justice) | 铁面无私、合规至上、安全审查最高权威、措辞冷峻精确、判决不可上诉 |

**编写要求**：
- 每个 SOUL.md 1000-2000 字
- 人设要有鲜明个性差异，避免"AI味"的温和中立
- System Prompt 部分要能直接注入 LLM，结构完整
- 激进派和保守派之间要有明显的立场冲突，这是辩论引擎的动力来源

### Step 3：创建 `constitution.yaml`

在 `config/constitution.yaml` 中定义全局红线配置：

```yaml
version: "1.0"

# 司法审查规则
judicial:
  # 命令黑名单 — 行政分支执行时，这些命令触发违宪
  blacklist_commands:
    - "rm -rf"
    - "DROP TABLE"
    - "FORMAT"
    - "deltree"
    - "mkfs"
    - "dd if="
    - ":(){ :|:& };:"     # Fork bomb
    - "chmod -R 777"
    - "> /dev/sda"

  # Token 预算
  token_budget:
    max_per_task: 100000
    debate_budget: 30000
    execution_budget: 50000
    review_budget: 20000

  # 辩论规则
  debate:
    max_rounds: 10
    conflict_threshold: 80
    consensus_threshold: 30
    min_rounds: 2

  # 产出偏离度
  deviation:
    max_score: 0.3

# 安全沙箱
security:
  sandbox_enabled: true
  allowed_file_extensions:
    - ".py"
    - ".js"
    - ".ts"
    - ".md"
    - ".json"
    - ".yaml"
    - ".yml"
    - ".toml"
    - ".txt"
    - ".html"
    - ".css"
  max_execution_time_seconds: 300
  max_file_size_mb: 10
  network_access: restricted

# 权限矩阵 (RBAC)
rbac:
  permissions:
    - PLAN          # 规划权 — 生成方案/法案
    - EXECUTE       # 执行权 — 调用工具/写代码
    - MONITOR       # 监控权 — 旁路监听
    - VETO          # 否决权 — 打回法案
    - KILL          # 熔断权 — 强制终止

  role_permissions:
    speaker:        [PLAN]
    radical_mp:     [PLAN]
    conservative_mp:[PLAN]
    president:      [PLAN, VETO]
    sec_engineering: [EXECUTE]
    sec_state:      [EXECUTE]
    chief_justice:  [MONITOR, KILL]
```

### Step 4：实现 Pydantic 配置模型

在 `openclaw_republic/config/models.py` 中：

```python
"""Pydantic 模型 — constitution.yaml 的类型安全表示。"""

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

class TokenBudgetConfig(BaseModel):
    max_per_task: int = Field(ge=1000)
    debate_budget: int = Field(ge=500)
    execution_budget: int = Field(ge=500)
    review_budget: int = Field(ge=500)

class DebateConfig(BaseModel):
    max_rounds: int = Field(ge=1, le=50)
    conflict_threshold: int = Field(ge=0, le=100)
    consensus_threshold: int = Field(ge=0, le=100)
    min_rounds: int = Field(ge=1)

class DeviationConfig(BaseModel):
    max_score: float = Field(ge=0.0, le=1.0)

class JudicialConfig(BaseModel):
    blacklist_commands: list[str]
    token_budget: TokenBudgetConfig
    debate: DebateConfig
    deviation: DeviationConfig

class SecurityConfig(BaseModel):
    sandbox_enabled: bool = True
    allowed_file_extensions: list[str]
    max_execution_time_seconds: int = Field(ge=1)
    max_file_size_mb: int = Field(ge=1)
    network_access: str = "restricted"

class RBACConfig(BaseModel):
    permissions: list[str]
    role_permissions: dict[str, list[str]]

class ConstitutionConfig(BaseModel):
    version: str
    judicial: JudicialConfig
    security: SecurityConfig
    rbac: RBACConfig
```

### Step 5：实现配置加载器

在 `openclaw_republic/config/loader.py` 中：

```python
"""配置加载器 — 加载 constitution.yaml 和 SOUL.md 文件。"""

from pathlib import Path
import yaml
from .models import ConstitutionConfig

def load_constitution(path: str | Path) -> ConstitutionConfig:
    """加载并校验 constitution.yaml。"""
    ...

def load_soul(path: str | Path) -> str:
    """加载单个 SOUL.md 文件，返回其内容。"""
    ...

def load_all_souls(directory: str | Path) -> dict[str, str]:
    """加载目录下所有 SOUL.md 文件，返回 {角色名: 内容} 字典。"""
    ...
```

### Step 6：定义结构化事件基类

在 `openclaw_republic/schemas/events.py` 中：

```python
"""结构化事件模型 — 对标 PRD v3 §4 WebSocket 事件格式。"""

from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field
from typing import Any

class EventAction(str, Enum):
    """事件动作类型 — 直接映射 PRD §4 的 WebSocket 事件。"""
    PROPOSE = "propose"           # 提案
    BRAWL = "brawl"               # 辩论/争吵
    ORDER = "order"               # 议长控场
    VOTE_PASSED = "vote_passed"   # 表决通过
    SIGN_ACT = "sign_act"         # 总统签署
    VETO = "veto"                 # 总统否决
    TOOL_CALL = "tool_call"       # 工具调用
    CONSTITUTIONAL = "constitutional"         # 合宪判决
    UNCONSTITUTIONAL = "unconstitutional"     # 违宪判决

class EmotionType(str, Enum):
    """情绪类型 — 驱动前端动画表现。"""
    NEUTRAL = "neutral"
    PASSIONATE = "passionate"
    ANGRY = "angry"
    CONFIDENT = "confident"
    WORRIED = "worried"
    TRIUMPHANT = "triumphant"
    STERN = "stern"

class BaseEvent(BaseModel):
    """所有系统事件的基类。"""
    timestamp: datetime = Field(default_factory=datetime.now)
    source_agent: str = Field(description="发出事件的 Agent 角色名")
    target_agent: str | None = Field(default=None, description="目标 Agent（如有）")
    action: EventAction = Field(description="事件动作类型")
    emotion: EmotionType = Field(default=EmotionType.NEUTRAL)
    intensity: float = Field(default=0.5, ge=0.0, le=1.0, description="情绪强度 0~1")
    payload: dict[str, Any] = Field(default_factory=dict, description="自由扩展字段")
    task_id: str | None = Field(default=None, description="关联的任务 ID")

class DebateEvent(BaseEvent):
    """辩论事件 — 议会辩论中的发言/反驳。"""
    round_number: int = Field(ge=1)
    conflict_score: float = Field(ge=0.0, le=100.0)
    statement: str = Field(description="发言内容")

class VoteEvent(BaseEvent):
    """表决事件。"""
    action: EventAction = EventAction.VOTE_PASSED
    ayes: int = Field(ge=0)
    nays: int = Field(ge=0)
    result: str = Field(description="passed 或 rejected")

class ExecutionEvent(BaseEvent):
    """行政执行事件。"""
    tool_name: str = Field(description="调用的工具/Skill 名称")
    step_index: int = Field(ge=0)
    status: str = Field(description="running / success / failed")

class JudgmentEvent(BaseEvent):
    """司法判决事件。"""
    violation_type: str | None = Field(default=None, description="违宪类型")
    ruling: str = Field(description="判决摘要")
    evidence: list[str] = Field(default_factory=list)
```

### Step 7：配置 structlog 日志系统

在 `openclaw_republic/config/__init__.py` 或专门的 `logging.py` 中：

```python
"""统一日志配置 — 基于 structlog。"""

import structlog

def setup_logging(log_level: str = "INFO") -> None:
    """初始化 structlog 统一日志。"""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.ConsoleRenderer(),  # 开发环境
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
```

### Step 8：编写单元测试

```
tests/unit/
├── test_config_loader.py       # 测试 constitution.yaml 加载 & Pydantic 校验
├── test_soul_loader.py         # 测试 SOUL.md 加载
└── test_events.py              # 测试事件基类创建 & 序列化
```

**测试要点**：
- `constitution.yaml` 可被 `load_constitution()` 加载，返回 `ConstitutionConfig` 实例
- 各字段约束生效（如 `conflict_threshold` 范围 0~100）
- 无效配置抛出 `ValidationError`
- 7 个 SOUL.md 文件均可加载
- `BaseEvent` 及其子类可正确实例化和 JSON 序列化
- `EventAction` 枚举覆盖 PRD §4 定义的所有 9 种事件类型

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `config/souls/SOUL_TEMPLATE.md` | SOUL.md 编写规范模板 |
| `config/souls/speaker.md` | 议长人设 |
| `config/souls/radical_mp.md` | 激进派议员人设 |
| `config/souls/conservative_mp.md` | 保守派议员人设 |
| `config/souls/president.md` | 总统人设 |
| `config/souls/sec_engineering.md` | 工程部长人设 |
| `config/souls/sec_state.md` | 国务卿人设 |
| `config/souls/chief_justice.md` | 首席大法官人设 |
| `config/constitution.yaml` | 宪法全局红线配置 |
| `openclaw_republic/config/models.py` | Pydantic 配置模型（实现） |
| `openclaw_republic/config/loader.py` | 配置加载器（实现） |
| `openclaw_republic/schemas/events.py` | 结构化事件模型（实现） |
| `tests/unit/test_config_loader.py` | 配置加载单测 |
| `tests/unit/test_soul_loader.py` | SOUL 加载单测 |
| `tests/unit/test_events.py` | 事件模型单测 |

---

## 验收标准

- [x] 7 个 SOUL.md 文件就位，每个 1000-2000 字，人设鲜明 — ✅ 7 个角色均已编写
- [x] `constitution.yaml` 可被 Pydantic 加载校验，无 ValidationError — ✅
- [x] `load_constitution("config/constitution.yaml")` 返回 `ConstitutionConfig` 实例 — ✅
- [x] `load_all_souls("config/souls/")` 返回 7 个角色的内容字典 — ✅
- [x] `BaseEvent` 及所有子类可实例化并 JSON 序列化 — ✅
- [x] `EventAction` 枚举覆盖全部 9 种 PRD §4 事件类型 — ✅
- [x] structlog 日志可正常输出结构化日志 — ✅
- [x] `pytest tests/unit/test_config_loader.py tests/unit/test_soul_loader.py tests/unit/test_events.py` 全绿 — ✅ 48 passed in 0.35s

---

## 设计决策备忘

1. **SOUL.md vs YAML 人设**：选择 Markdown 格式是因为 System Prompt 本质是自然语言，Markdown 更适合创作和阅读。YAML 只用于结构化配置（constitution）。
2. **事件基类用 Pydantic**：既保证类型安全，又原生支持 JSON 序列化，为 Phase 2 WebSocket 推送做好准备。
3. **emotion + intensity 二维情绪**：比单一情绪标签更灵活，可精细控制前端动画表现力。

---

## 不包含（由其他 Task 处理）

- ❌ Agent 基类逻辑实现（→ Phase 1）
- ❌ pre-commit / CI / Docker（→ Task 0-C）
- ❌ 消息总线实现（→ Phase 1）

---

## 后续衔接

完成后进入 → [Task 0-C · Dev 工具链 & 容器化](task0.3_devtools_and_ci.md)

---

## 完成记录

- **完成时间**：2026-03-20
- **验收结果**：8/8 全部通过
- **测试概况**：48 passed in 0.35s（含 smoke tests）
- **新增依赖**：pyyaml>=6.0（constitution.yaml 解析）
- **额外产出**：`openclaw_republic/config/logging.py`（structlog 日志配置独立模块）
