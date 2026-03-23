# mypy: ignore-errors
"""单元测试 — ChiefJustice（首席大法官 Agent）。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.base import Branch, Permission, PermissionDeniedError
from openclaw_republic.agents.judicial.chief_justice import ChiefJustice
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
from openclaw_republic.schemas.events import EventAction, ExecutionEvent, JudgmentEvent
from openclaw_republic.schemas.verdict import ViolationType


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_constitution(*, max_deviation: float = 0.3) -> ConstitutionConfig:
    return ConstitutionConfig(
        version="1.0-test",
        judicial=JudicialConfig(
            blacklist_commands=["rm -rf", "DROP TABLE"],
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
            allowed_file_extensions=[".py", ".js", ".md"],
            max_execution_time_seconds=300,
            max_file_size_mb=10,
            network_access="restricted",
        ),
        rbac=RBACConfig(
            permissions=["PLAN", "EXECUTE", "MONITOR", "VETO", "KILL"],
            role_permissions={"chief_justice": ["MONITOR", "KILL"]},
        ),
    )


def _make_event(
    *,
    tool_name: str = "CodeExecution",
    command: str | None = None,
) -> ExecutionEvent:
    payload: dict[str, object] = {
        "tokens_consumed": 0,
        "execution_time": 0.0,
    }
    if command is not None:
        payload["command"] = command
    return ExecutionEvent(
        source_agent="sec_engineering",
        action=EventAction.TOOL_CALL,
        tool_name=tool_name,
        step_index=0,
        status="running",
        payload=payload,
    )


def _make_report(
    *,
    outputs: list[str] | None = None,
    act_id: str = "act-test",
) -> ExecutionReport:
    if outputs is None:
        outputs = ["执行成功"]
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
        execution_time_seconds=5.0,
    )


# ---------------------------------------------------------------------------
# 初始化与权限
# ---------------------------------------------------------------------------


class TestChiefJusticeInit:
    """ChiefJustice 初始化测试。"""

    def test_default_init(self) -> None:
        """默认初始化属性正确。"""
        cj = ChiefJustice(_make_constitution())
        assert cj.name == "Chief Justice"
        assert cj.role == "chief_justice"
        assert cj.branch == Branch.JUDICIAL

    def test_has_monitor_permission(self) -> None:
        """拥有 MONITOR 权限。"""
        cj = ChiefJustice(_make_constitution())
        assert cj.has_permission(Permission.MONITOR)

    def test_has_kill_permission(self) -> None:
        """拥有 KILL 权限。"""
        cj = ChiefJustice(_make_constitution())
        assert cj.has_permission(Permission.KILL)

    def test_no_plan_permission(self) -> None:
        """不拥有 PLAN 权限。"""
        cj = ChiefJustice(_make_constitution())
        assert not cj.has_permission(Permission.PLAN)

    def test_no_execute_permission(self) -> None:
        """不拥有 EXECUTE 权限。"""
        cj = ChiefJustice(_make_constitution())
        assert not cj.has_permission(Permission.EXECUTE)

    def test_no_veto_permission(self) -> None:
        """不拥有 VETO 权限。"""
        cj = ChiefJustice(_make_constitution())
        assert not cj.has_permission(Permission.VETO)

    def test_rbac_plan_denied(self) -> None:
        """PLAN 权限校验抛出异常。"""
        cj = ChiefJustice(_make_constitution())
        with pytest.raises(PermissionDeniedError):
            cj.require_permission(Permission.PLAN)

    def test_rbac_execute_denied(self) -> None:
        """EXECUTE 权限校验抛出异常。"""
        cj = ChiefJustice(_make_constitution())
        with pytest.raises(PermissionDeniedError):
            cj.require_permission(Permission.EXECUTE)


# ---------------------------------------------------------------------------
# monitor_execution — 过程审查
# ---------------------------------------------------------------------------


class TestMonitorExecution:
    """monitor_execution() 测试。"""

    @pytest.mark.asyncio
    async def test_safe_action_passes(self) -> None:
        """安全操作通过过程审查。"""
        cj = ChiefJustice(_make_constitution())
        event = _make_event(command="python main.py")
        result = await cj.monitor_execution(event)
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_blacklist_detected(self) -> None:
        """黑名单命令被检测。"""
        cj = ChiefJustice(_make_constitution())
        event = _make_event(command="rm -rf /")
        result = await cj.monitor_execution(event)
        assert result.passed is False

    @pytest.mark.asyncio
    async def test_loop_detected(self) -> None:
        """死循环检测。"""
        cj = ChiefJustice(_make_constitution())

        for _ in range(4):
            result = await cj.monitor_execution(
                _make_event(tool_name="RepeatedTool"),
            )
            assert result.passed is True

        # 第 5 次
        result = await cj.monitor_execution(
            _make_event(tool_name="RepeatedTool"),
        )
        assert result.passed is False


# ---------------------------------------------------------------------------
# review_result — 结果审查
# ---------------------------------------------------------------------------


class TestReviewResult:
    """review_result() 测试。"""

    @pytest.mark.asyncio
    async def test_constitutional_result(self) -> None:
        """低偏离度 → 合宪判决。"""
        cj = ChiefJustice(_make_constitution())
        report = _make_report()
        verdict = await cj.review_result("请帮我写代码", report)
        assert verdict.constitutional is True
        assert verdict.act_id == report.act_id

    @pytest.mark.asyncio
    async def test_unconstitutional_result(self) -> None:
        """高偏离度 → 违宪判决。"""

        async def high_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 0.9

        cj = ChiefJustice(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=high_scorer,
        )
        report = _make_report()
        verdict = await cj.review_result("请帮我写代码", report)
        assert verdict.constitutional is False
        assert verdict.violation_type == ViolationType.DEVIATION_EXCEEDED
        assert verdict.remediation is not None


# ---------------------------------------------------------------------------
# issue_judgment — 发出判决
# ---------------------------------------------------------------------------


class TestIssueJudgment:
    """issue_judgment() 测试。"""

    @pytest.mark.asyncio
    async def test_constitutional_judgment_event(self) -> None:
        """合宪判决生成 CONSTITUTIONAL 事件。"""
        cj = ChiefJustice(_make_constitution())
        report = _make_report()
        verdict = await cj.review_result("请帮我写代码", report)
        event = await cj.issue_judgment(verdict)

        assert isinstance(event, JudgmentEvent)
        assert event.action == EventAction.CONSTITUTIONAL
        assert event.source_agent == "chief_justice"

    @pytest.mark.asyncio
    async def test_unconstitutional_judgment_triggers_kill(self) -> None:
        """违宪判决触发 Kill Switch。"""

        async def high_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 0.9

        cj = ChiefJustice(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=high_scorer,
        )
        report = _make_report()
        verdict = await cj.review_result("test", report)
        event = await cj.issue_judgment(verdict)

        assert event.action == EventAction.UNCONSTITUTIONAL
        # Kill report 应在 payload 中
        assert event.payload.get("kill_report") is not None

    @pytest.mark.asyncio
    async def test_judgment_targets_speaker(self) -> None:
        """判决事件通知立法分支议长。"""
        cj = ChiefJustice(_make_constitution())
        report = _make_report()
        verdict = await cj.review_result("test", report)
        event = await cj.issue_judgment(verdict)
        assert event.target_agent == "speaker"


# ---------------------------------------------------------------------------
# act() 入口
# ---------------------------------------------------------------------------


class TestChiefJusticeAct:
    """ChiefJustice.act() 入口测试。"""

    @pytest.mark.asyncio
    async def test_act_with_execution_event(self) -> None:
        """传入 ExecutionEvent 时委托给 monitor_execution。"""
        cj = ChiefJustice(_make_constitution())
        event = _make_event(command="ls -la")
        result = await cj.act(event)
        assert result.passed is True  # type: ignore[union-attr]

    @pytest.mark.asyncio
    async def test_act_with_wrong_type(self) -> None:
        """传入非支持类型时抛出 TypeError。"""
        cj = ChiefJustice(_make_constitution())
        with pytest.raises(TypeError):
            await cj.act("not an event")
