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


# ---------------------------------------------------------------------------
# 行政分支模型 — 总统审查 / 否决 / 任务派发 / 执行报告
# ---------------------------------------------------------------------------

#: 签署或否决。
SignOrVeto = Literal["sign", "veto"]


class VetoNotice(BaseModel):
    """否决通知 — 总统打回法案的理由。"""

    act_id: str = Field(description="被否决的法案 ID")
    reason: str = Field(description="否决总述")
    specific_issues: list[str] = Field(
        min_length=1,
        description="具体问题列表",
    )
    suggestion: str | None = Field(
        default=None,
        description="修改建议",
    )


class ExecutionTask(BaseModel):
    """总统拆解后分派给内阁的单个任务。"""

    task_id: str = Field(description="任务唯一 ID")
    act_id: str = Field(description="所属法案 ID")
    step: ActStep = Field(description="对应的法案步骤")
    assigned_to: str = Field(description="被分派的部长角色名")


class TaskResult(BaseModel):
    """单个步骤的执行结果。"""

    task_id: str = Field(description="任务 ID")
    step_index: int = Field(ge=0, description="步骤编号")
    status: Literal["success", "failed", "skipped"] = Field(
        description="执行状态",
    )
    output: str = Field(default="", description="执行输出")
    tokens_consumed: int = Field(default=0, ge=0, description="消耗 Token 数")
    error: str | None = Field(default=None, description="错误信息")


class ExecutionReport(BaseModel):
    """法案执行报告 — 汇总所有步骤执行结果。"""

    act_id: str = Field(description="法案 ID")
    overall_status: Literal["completed", "partial", "failed"] = Field(
        description="整体执行状态",
    )
    task_results: list[TaskResult] = Field(description="各步骤执行结果")
    total_tokens_consumed: int = Field(ge=0, description="总 Token 消耗")
    execution_time_seconds: float = Field(ge=0.0, description="总执行时间（秒）")
