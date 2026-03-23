# mypy: ignore-errors
"""单元测试 — 行政执行引擎 (ExecutionEngine)。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.executive.engine import ExecutionEngine
from openclaw_republic.agents.executive.sec_engineering import SecretaryOfEngineering
from openclaw_republic.agents.executive.sec_state import SecretaryOfState
from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ActVoteRecord,
    DebateRecord,
    ExecutionReport,
    TaskResult,
)


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


def _make_act(
    steps: list[ActStep] | None = None,
    *,
    act_id: str = "act-engine-001",
) -> Act:
    """创建测试用法案。"""
    if steps is None:
        steps = [
            ActStep(
                index=0,
                description="编写代码",
                required_skill="CodeExecution",
                estimated_tokens=3000,
                acceptance_criteria="完成",
            ),
        ]
    total_tokens = sum(s.estimated_tokens for s in steps)
    return Act(
        act_id=act_id,
        title="测试法案",
        summary="用于执行引擎单测",
        petition_origin="请帮我写代码",
        steps=steps,
        total_estimated_tokens=total_tokens,
        debate_record=DebateRecord(
            total_rounds=2,
            final_conflict_score=15.0,
        ),
        vote_record=ActVoteRecord(
            ayes=2, nays=0, result="passed",
        ),
    )


def _build_cabinet() -> dict[str, SecretaryOfEngineering | SecretaryOfState]:
    """构建默认内阁映射。"""
    eng = SecretaryOfEngineering()
    state = SecretaryOfState()
    return {
        "CodeExecution": eng,
        "Python_Interpreter": eng,
        "GitHub": eng,
        "WebBrowser": state,
        "Search": state,
    }


# ---------------------------------------------------------------------------
# 基本执行
# ---------------------------------------------------------------------------


class TestExecutionEngineBasic:
    """ExecutionEngine 基本执行测试。"""

    @pytest.mark.asyncio
    async def test_single_step_success(self) -> None:
        """单步骤法案成功执行。"""
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act()
        report = await engine.execute_act(act)
        assert isinstance(report, ExecutionReport)
        assert report.overall_status == "completed"
        assert len(report.task_results) == 1
        assert report.task_results[0].status == "success"

    @pytest.mark.asyncio
    async def test_multi_step_success(self) -> None:
        """多步骤法案全部成功。"""
        steps = [
            ActStep(
                index=0,
                description="搜索资料",
                required_skill="Search",
                estimated_tokens=2000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="编写代码",
                required_skill="CodeExecution",
                estimated_tokens=3000,
                acceptance_criteria="完成",
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "completed"
        assert len(report.task_results) == 2

    @pytest.mark.asyncio
    async def test_act_id_in_report(self) -> None:
        """报告的 act_id 与法案一致。"""
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(act_id="act-check-id")
        report = await engine.execute_act(act)
        assert report.act_id == "act-check-id"

    @pytest.mark.asyncio
    async def test_execution_time_positive(self) -> None:
        """执行时间为正数。"""
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act()
        report = await engine.execute_act(act)
        assert report.execution_time_seconds >= 0.0


# ---------------------------------------------------------------------------
# Token 追踪
# ---------------------------------------------------------------------------


class TestExecutionEngineTokens:
    """Token 消耗追踪测试。"""

    @pytest.mark.asyncio
    async def test_total_tokens(self) -> None:
        """总 Token 消耗等于各步骤之和。"""
        steps = [
            ActStep(
                index=0,
                description="步骤 A",
                required_skill="CodeExecution",
                estimated_tokens=3000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="步骤 B",
                required_skill="Search",
                estimated_tokens=2000,
                acceptance_criteria="完成",
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.total_tokens_consumed == 5000


# ---------------------------------------------------------------------------
# 依赖关系与拓扑排序
# ---------------------------------------------------------------------------


class TestExecutionEngineDependencies:
    """步骤依赖关系与拓扑排序测试。"""

    @pytest.mark.asyncio
    async def test_sequential_dependencies(self) -> None:
        """线性依赖链正确按顺序执行。"""
        steps = [
            ActStep(
                index=0,
                description="初始化",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="编写代码",
                required_skill="CodeExecution",
                estimated_tokens=2000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
            ActStep(
                index=2,
                description="运行测试",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[1],
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "completed"
        assert len(report.task_results) == 3
        assert all(r.status == "success" for r in report.task_results)

    @pytest.mark.asyncio
    async def test_parallel_independent_steps(self) -> None:
        """无依赖的步骤可并行（均成功）。"""
        steps = [
            ActStep(
                index=0,
                description="搜索资料",
                required_skill="Search",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="编写代码",
                required_skill="CodeExecution",
                estimated_tokens=2000,
                acceptance_criteria="完成",
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "completed"
        assert len(report.task_results) == 2

    @pytest.mark.asyncio
    async def test_diamond_dependency(self) -> None:
        """菱形依赖正确处理：0 → (1,2) → 3。"""
        steps = [
            ActStep(
                index=0,
                description="初始化",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="路径 A",
                required_skill="Search",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
            ActStep(
                index=2,
                description="路径 B",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
            ActStep(
                index=3,
                description="合并",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[1, 2],
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "completed"
        assert len(report.task_results) == 4


# ---------------------------------------------------------------------------
# 失败传播 — skip 机制
# ---------------------------------------------------------------------------


class TestExecutionEngineFailure:
    """步骤失败与 skip 传播测试。"""

    @pytest.mark.asyncio
    async def test_missing_skill_fails_step(self) -> None:
        """Skill 缺失导致步骤失败。"""
        engine = ExecutionEngine(cabinet=_build_cabinet())
        steps = [
            ActStep(
                index=0,
                description="魔法步骤",
                required_skill="MagicWand",  # 没有此 Skill
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
        ]
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "failed"
        assert report.task_results[0].status == "failed"

    @pytest.mark.asyncio
    async def test_dependent_step_skipped_on_failure(self) -> None:
        """前置步骤失败 → 依赖它的后续步骤被 skip。"""
        steps = [
            ActStep(
                index=0,
                description="魔法步骤",
                required_skill="MagicWand",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="后续步骤",
                required_skill="CodeExecution",
                estimated_tokens=2000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.task_results[0].status == "failed"
        assert report.task_results[1].status == "skipped"

    @pytest.mark.asyncio
    async def test_partial_status(self) -> None:
        """部分步骤成功、部分失败 → overall_status 为 partial。"""
        steps = [
            ActStep(
                index=0,
                description="正常步骤",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="魔法步骤",
                required_skill="MagicWand",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.overall_status == "partial"

    @pytest.mark.asyncio
    async def test_cascade_skip(self) -> None:
        """级联 skip：0 失败 → 1 skip → 2 skip。"""
        steps = [
            ActStep(
                index=0,
                description="魔法步骤",
                required_skill="MagicWand",
                estimated_tokens=1000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="步骤 1",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
            ActStep(
                index=2,
                description="步骤 2",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="完成",
                dependencies=[1],
            ),
        ]
        engine = ExecutionEngine(cabinet=_build_cabinet())
        act = _make_act(steps=steps)
        report = await engine.execute_act(act)
        assert report.task_results[0].status == "failed"
        assert report.task_results[1].status == "skipped"
        assert report.task_results[2].status == "skipped"


# ---------------------------------------------------------------------------
# resolve_skill
# ---------------------------------------------------------------------------


class TestResolveSkill:
    """resolve_skill 测试。"""

    def test_known_skill(self) -> None:
        """已知 Skill 返回对应执行者。"""
        cabinet = _build_cabinet()
        engine = ExecutionEngine(cabinet=cabinet)
        executor = engine.resolve_skill("CodeExecution")
        assert executor is not None
        assert executor.role == "sec_engineering"

    def test_unknown_skill(self) -> None:
        """未知 Skill 返回 None。"""
        engine = ExecutionEngine(cabinet=_build_cabinet())
        assert engine.resolve_skill("MagicWand") is None


# ---------------------------------------------------------------------------
# ExecutionReport / TaskResult 模型
# ---------------------------------------------------------------------------


class TestExecutionReportModel:
    """ExecutionReport 数据模型测试。"""

    def test_creation(self) -> None:
        """ExecutionReport 可正常创建。"""
        report = ExecutionReport(
            act_id="act-001",
            overall_status="completed",
            task_results=[
                TaskResult(
                    task_id="t1",
                    step_index=0,
                    status="success",
                    output="done",
                    tokens_consumed=1000,
                ),
            ],
            total_tokens_consumed=1000,
            execution_time_seconds=0.5,
        )
        assert report.act_id == "act-001"
        assert report.overall_status == "completed"

    def test_json_roundtrip(self) -> None:
        """ExecutionReport JSON 序列化/反序列化。"""
        report = ExecutionReport(
            act_id="act-rt",
            overall_status="partial",
            task_results=[
                TaskResult(
                    task_id="t1",
                    step_index=0,
                    status="success",
                    output="ok",
                    tokens_consumed=500,
                ),
                TaskResult(
                    task_id="t2",
                    step_index=1,
                    status="failed",
                    error="boom",
                ),
            ],
            total_tokens_consumed=500,
            execution_time_seconds=1.2,
        )
        json_str = report.model_dump_json()
        restored = ExecutionReport.model_validate_json(json_str)
        assert restored.act_id == report.act_id
        assert len(restored.task_results) == 2
