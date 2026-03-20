"""《执行法案》数据模型 — 议会表决通过的结构化执行计划.

这是立法→行政的核心交接物。总统根据此文档
决定签署/否决，并拆解为具体任务派发内阁。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


class ActStep(BaseModel):
    """法案中的单个执行步骤。"""

    index: int = Field(ge=0, description="步骤编号")
    description: str = Field(description="步骤描述")
    required_skill: str = Field(description="所需 Skill 名称")
    tool_parameters: dict[str, Any] = Field(
        default_factory=dict,
        description="工具参数",
    )
    estimated_tokens: int = Field(ge=0, description="预估 Token 消耗")
    acceptance_criteria: str = Field(description="验收标准")
    dependencies: list[int] = Field(
        default_factory=list,
        description="依赖的步骤编号",
    )


class DebateRecord(BaseModel):
    """辩论记录摘要 — 嵌入法案中供行政分支参考。"""

    total_rounds: int = Field(ge=0, description="辩论总轮次")
    final_conflict_score: float = Field(
        ge=0.0,
        le=100.0,
        description="最终分歧度评分",
    )
    consensus_points: list[str] = Field(
        default_factory=list,
        description="共识要点列表",
    )
    remaining_concerns: list[str] = Field(
        default_factory=list,
        description="遗留争议列表",
    )


class ActVoteRecord(BaseModel):
    """法案表决记录。

    注意：与 ``debate.VoteRecord``（单票记录）区分，
    此处为法案级别的汇总表决结果。
    """

    ayes: int = Field(ge=0, description="赞成票数")
    nays: int = Field(ge=0, description="反对票数")
    result: Literal["passed", "rejected"] = Field(description="表决结果")
    voter_positions: dict[str, str] = Field(
        default_factory=dict,
        description="各角色投票立场 {角色名: 'aye'/'nay'}",
    )


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
    vote_record: ActVoteRecord = Field(description="表决记录")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc),
        description="创建时间",
    )
