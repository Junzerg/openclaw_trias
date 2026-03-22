"""REST API 响应模型。"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TaskSummary(BaseModel):
    task_id: str = Field(description="任务 ID")
    petition: str = Field(description="原始选民请愿内容")
    status: str = Field(description="任务执行状态（pending/running/completed/failed）")
    bill_state: str = Field(description="法案生命周期状态")
    created_at: datetime = Field(description="创建时间")


class TaskListResponse(BaseModel):
    total: int = Field(default=0, description="总数（占位符，如果未做 count 则可能不准确）")
    offset: int = Field(description="偏移量")
    limit: int = Field(description="单页限制")
    tasks: list[TaskSummary] = Field(description="任务列表")


class ActResponse(BaseModel):
    task_id: str = Field(description="任务 ID")
    act: dict[str, Any] = Field(description="完整的法案数据 (JSON)")
    created_at: datetime = Field(description="生成时间")


class DebateRound(BaseModel):
    round_number: int = Field(description="轮次")
    radical_statement: str = Field(description="激进派发言", default="")
    conservative_statement: str = Field(description="保守派发言", default="")
    conflict_score: float = Field(description="该轮的冲突分", default=0.0)


class DebateResponse(BaseModel):
    task_id: str = Field(description="任务 ID")
    rounds: list[DebateRound] = Field(default_factory=list, description="辩论发言记录回合")
    conflict_score_curve: list[float] = Field(default_factory=list, description="每个事件节点的分歧度曲线")


class VerdictResponse(BaseModel):
    task_id: str = Field(description="任务 ID")
    constitutional: bool = Field(description="是否合宪")
    ruling: str = Field(description="判决摘要")
    evidence: list[str] = Field(default_factory=list, description="判决证据")
    created_at: datetime = Field(description="判决产生时间")
