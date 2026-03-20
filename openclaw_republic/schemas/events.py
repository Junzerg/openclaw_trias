"""结构化事件模型 — 对标 PRD v3 §4 WebSocket 事件格式。"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventAction(str, Enum):
    """事件动作类型 — 直接映射 PRD §4 的 WebSocket 事件。"""

    PROPOSE = "propose"  # 提案
    BRAWL = "brawl"  # 辩论/争吵
    ORDER = "order"  # 议长控场
    VOTE_PASSED = "vote_passed"  # 表决通过
    SIGN_ACT = "sign_act"  # 总统签署
    VETO = "veto"  # 总统否决
    TOOL_CALL = "tool_call"  # 工具调用
    CONSTITUTIONAL = "constitutional"  # 合宪判决
    UNCONSTITUTIONAL = "unconstitutional"  # 违宪判决


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

    round_number: int = Field(ge=1, description="当前辩论轮次")
    conflict_score: float = Field(ge=0.0, le=100.0, description="辩论分歧度")
    statement: str = Field(description="发言内容")


class VoteEvent(BaseEvent):
    """表决事件。"""

    action: EventAction = EventAction.VOTE_PASSED
    ayes: int = Field(ge=0, description="赞成票数")
    nays: int = Field(ge=0, description="反对票数")
    result: str = Field(description="passed 或 rejected")


class ExecutionEvent(BaseEvent):
    """行政执行事件。"""

    tool_name: str = Field(description="调用的工具/Skill 名称")
    step_index: int = Field(ge=0, description="执行步骤索引")
    status: str = Field(description="running / success / failed")


class JudgmentEvent(BaseEvent):
    """司法判决事件。"""

    violation_type: str | None = Field(default=None, description="违宪类型")
    ruling: str = Field(description="判决摘要")
    evidence: list[str] = Field(default_factory=list, description="证据列表")
