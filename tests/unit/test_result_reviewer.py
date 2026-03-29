"""单元测试 — ResultReviewer（结果违宪审查）。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.judicial.result_reviewer import ResultReviewer
from openclaw_republic.agents.judicial.rules_engine import RulesEngine
from openclaw_republic.config.models import (
    ConstitutionConfig,
    DebateConfig,
    DeviationConfig,
    JudicialConfig,
    RBACConfig,
    SecurityConfig,
    TokenBudgetConfig,
)
from openclaw_republic.schemas.act import ExecutionReport, TaskResult


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_constitution(*, max_deviation: float = 0.3) -> ConstitutionConfig:
    return ConstitutionConfig(
        version="1.0-test",
        judicial=JudicialConfig(
            blacklist_commands=["rm -rf"],
            token_budget=TokenBudgetConfig(
                max_per_task=100_000,
                debate_budget=30_000,
                execution_budget=50_000,
                review_budget=20_000,
            ),
            debate=DebateConfig(
                max_rounds=10,
                conflict_threshold=80,
                consensus_threshold=30,
                min_rounds=2,
            ),
            deviation=DeviationConfig(max_score=max_deviation),
        ),
        security=SecurityConfig(
            sandbox_enabled=True,
            allowed_file_extensions=[".py"],
            max_execution_time_seconds=300,
            max_file_size_mb=10,
            network_access="restricted",
        ),
        rbac=RBACConfig(
            permissions=["PLAN", "EXECUTE", "MONITOR", "VETO", "KILL"],
            role_permissions={"chief_justice": ["MONITOR", "KILL"]},
        ),
    )


def _make_report(
    *,
    outputs: list[str] | None = None,
    act_id: str = "act-001",
) -> ExecutionReport:
    if outputs is None:
        outputs = ["代码执行成功"]
    results = [
        TaskResult(
            task_id=f"task-{i}",
            step_index=i,
            status="success",
            output=o,
            tokens_consumed=100,
        )
        for i, o in enumerate(outputs)
    ]
    return ExecutionReport(
        act_id=act_id,
        overall_status="completed",
        task_results=results,
        total_tokens_consumed=sum(r.tokens_consumed for r in results),
        execution_time_seconds=10.0,
    )


# ---------------------------------------------------------------------------
# 测试
# ---------------------------------------------------------------------------


class TestResultReviewerPass:
    """偏离度低 → 通过。"""

    @pytest.mark.asyncio
    async def test_low_deviation_passes(self) -> None:
        """默认 Mock 评分器（0.1）低于阈值 0.3 → 合宪。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ResultReviewer(rules)
        result = await reviewer.review_delivery(
            "请帮我写代码",
            _make_report(),
        )
        assert result.passed is True
        assert result.deviation.score <= 0.3


class TestResultReviewerFail:
    """偏离度高 → 未通过。"""

    @pytest.mark.asyncio
    async def test_high_deviation_fails(self) -> None:
        """自定义高评分函数 → 违宪。"""

        async def high_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 0.8

        rules = RulesEngine(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=high_scorer,
        )
        reviewer = ResultReviewer(rules)
        result = await reviewer.review_delivery(
            "请帮我写代码",
            _make_report(),
        )
        assert result.passed is False
        assert result.deviation.score == 0.8


class TestResultReviewerEdgeCases:
    """边界场景。"""

    @pytest.mark.asyncio
    async def test_empty_outputs(self) -> None:
        """所有步骤失败 → 无有效产出，仍进行偏离度评估。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ResultReviewer(rules)
        report = ExecutionReport(
            act_id="act-empty",
            overall_status="failed",
            task_results=[
                TaskResult(
                    task_id="t-1",
                    step_index=0,
                    status="failed",
                    error="执行失败",
                ),
            ],
            total_tokens_consumed=0,
            execution_time_seconds=1.0,
        )
        result = await reviewer.review_delivery("请帮我写代码", report)
        # 默认 Mock 依然返回低分
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_multiple_outputs_concatenated(self) -> None:
        """多个成功步骤的输出拼接传递给评分函数。"""
        call_args: list[str] = []

        async def capture_scorer(petition: str, output: str) -> float:
            call_args.append(output)
            return 0.1

        rules = RulesEngine(
            _make_constitution(),
            deviation_scorer=capture_scorer,
        )
        reviewer = ResultReviewer(rules)
        report = _make_report(outputs=["输出A", "输出B"])
        await reviewer.review_delivery("test", report)
        assert len(call_args) == 1
        assert "输出A" in call_args[0]
        assert "输出B" in call_args[0]
