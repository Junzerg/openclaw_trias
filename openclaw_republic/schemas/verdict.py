"""司法判决模型 — 违宪审查结果的结构化表示。

包含违宪类型枚举、单条规则检查结果、偏离度评估、
过程/结果审查汇总、最终判决书与熔断报告。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 违宪类型枚举
# ---------------------------------------------------------------------------


class ViolationType(str, Enum):
    """违宪类型 — 覆盖所有可能的违宪行为分类。"""

    BLACKLIST_COMMAND = "blacklist_command"
    RESOURCE_EXCEEDED = "resource_exceeded"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    FILE_ACCESS_VIOLATION = "file_access_violation"
    DEVIATION_EXCEEDED = "deviation_exceeded"
    INFINITE_LOOP = "infinite_loop"


# ---------------------------------------------------------------------------
# 审查子结果
# ---------------------------------------------------------------------------


class RuleCheckResult(BaseModel):
    """单条规则校验结果。"""

    passed: bool = Field(description="是否通过校验")
    rule_name: str = Field(description="规则名称")
    violation_detail: str | None = Field(
        default=None,
        description="违规详情（通过时为 None）",
    )


class DeviationResult(BaseModel):
    """偏离度评估结果 — LLM-as-a-Judge 评分。"""

    score: float = Field(ge=0.0, le=1.0, description="偏离度评分 0~1")
    passed: bool = Field(description="score <= max_score 时为 True")
    explanation: str = Field(description="评估说明")


# ---------------------------------------------------------------------------
# 审查汇总
# ---------------------------------------------------------------------------


class ProcessReviewResult(BaseModel):
    """过程审查汇总 — 汇集所有过程合规检查结果。"""

    passed: bool = Field(description="所有检查均通过则为 True")
    checks: list[RuleCheckResult] = Field(
        default_factory=list,
        description="各项检查结果",
    )
    violations: list[str] = Field(
        default_factory=list,
        description="违规摘要列表",
    )


class ResultReviewResult(BaseModel):
    """结果审查汇总 — 交付验收结果。"""

    deviation: DeviationResult = Field(description="偏离度评估")
    passed: bool = Field(description="偏离度未超限则为 True")


# ---------------------------------------------------------------------------
# 最终判决
# ---------------------------------------------------------------------------


class Verdict(BaseModel):
    """司法判决 — 违宪审查的最终裁定。"""

    verdict_id: str = Field(description="判决唯一 ID")
    act_id: str = Field(description="关联的法案 ID")
    constitutional: bool = Field(description="True 合宪，False 违宪")
    ruling: str = Field(description="判决摘要")
    violation_type: ViolationType | None = Field(
        default=None,
        description="违宪类型（合宪时为 None）",
    )
    evidence: list[str] = Field(
        default_factory=list,
        description="证据列表",
    )
    process_review: ProcessReviewResult | None = Field(
        default=None,
        description="过程审查结果",
    )
    result_review: ResultReviewResult | None = Field(
        default=None,
        description="结果审查结果",
    )
    remediation: str | None = Field(
        default=None,
        description="补救建议",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc),
        description="创建时间",
    )


# ---------------------------------------------------------------------------
# 熔断报告
# ---------------------------------------------------------------------------


class KillReport(BaseModel):
    """熔断报告 — 违宪判定后的处置记录。"""

    verdict: Verdict = Field(description="触发熔断的判决")
    killed_processes: list[str] = Field(
        default_factory=list,
        description="已终止的进程列表",
    )
    rollback_success: bool = Field(description="状态回滚是否成功")
    judgment_document: str = Field(description="完整判决书文本")
