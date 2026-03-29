"""单元测试 — ProcessReviewer（过程违宪审查）。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.judicial.process_reviewer import ProcessReviewer
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
from openclaw_republic.schemas.events import EventAction, ExecutionEvent


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_constitution() -> ConstitutionConfig:
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
            deviation=DeviationConfig(max_score=0.3),
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
    file_path: str | None = None,
    tokens_consumed: int = 0,
    execution_time: float = 0.0,
) -> ExecutionEvent:
    payload: dict[str, object] = {}
    if command is not None:
        payload["command"] = command
    if file_path is not None:
        payload["file_path"] = file_path
    payload["tokens_consumed"] = tokens_consumed
    payload["execution_time"] = execution_time
    return ExecutionEvent(
        source_agent="sec_engineering",
        action=EventAction.TOOL_CALL,
        tool_name=tool_name,
        step_index=0,
        status="running",
        payload=payload,
    )


# ---------------------------------------------------------------------------
# 合规行为
# ---------------------------------------------------------------------------


class TestCompliantAction:
    """合规行为通过审查。"""

    @pytest.mark.asyncio
    async def test_safe_action_passes(self) -> None:
        """正常操作通过所有检查。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(command="python main.py")
        result = await reviewer.review_action(event)
        assert result.passed is True
        assert result.violations == []

    @pytest.mark.asyncio
    async def test_safe_file_access(self) -> None:
        """合规文件扩展名通过。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(file_path="app.py")
        result = await reviewer.review_action(event)
        assert result.passed is True


# ---------------------------------------------------------------------------
# 黑名单检测
# ---------------------------------------------------------------------------


class TestBlacklistDetection:
    """黑名单命令检测。"""

    @pytest.mark.asyncio
    async def test_blacklist_command_detected(self) -> None:
        """黑名单命令触发违宪。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(command="rm -rf /")
        result = await reviewer.review_action(event)
        assert result.passed is False
        assert any("blacklist" in v for v in result.violations)

    @pytest.mark.asyncio
    async def test_drop_table_detected(self) -> None:
        """DROP TABLE 触发违宪。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(command="DROP TABLE users;")
        result = await reviewer.review_action(event)
        assert result.passed is False


# ---------------------------------------------------------------------------
# 死循环检测
# ---------------------------------------------------------------------------


class TestLoopDetection:
    """死循环检测。"""

    @pytest.mark.asyncio
    async def test_loop_detected_at_threshold(self) -> None:
        """同一操作重复 5 次触发死循环违宪。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules, loop_threshold=5)

        for i in range(4):
            result = await reviewer.review_action(
                _make_event(tool_name="SameTool"),
            )
            assert result.passed is True, f"第 {i + 1} 次不应触发"

        # 第 5 次触发
        result = await reviewer.review_action(
            _make_event(tool_name="SameTool"),
        )
        assert result.passed is False
        assert any("infinite_loop" in v for v in result.violations)

    @pytest.mark.asyncio
    async def test_no_loop_with_different_tools(self) -> None:
        """不同工具交替不触发死循环。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules, loop_threshold=5)

        tools = ["ToolA", "ToolB", "ToolA", "ToolB", "ToolA"]
        for tool in tools:
            result = await reviewer.review_action(
                _make_event(tool_name=tool),
            )
            assert result.passed is True

    @pytest.mark.asyncio
    async def test_reset_clears_history(self) -> None:
        """reset() 清除操作历史。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules, loop_threshold=3)

        for _ in range(2):
            await reviewer.review_action(_make_event(tool_name="X"))

        reviewer.reset()

        # 重置后重新计数
        for _ in range(2):
            result = await reviewer.review_action(_make_event(tool_name="X"))
            assert result.passed is True


# ---------------------------------------------------------------------------
# 资源超限
# ---------------------------------------------------------------------------


class TestResourceExceeded:
    """资源超限检测。"""

    @pytest.mark.asyncio
    async def test_token_exceeded(self) -> None:
        """Token 超限。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(tokens_consumed=200_000)
        result = await reviewer.review_action(event)
        assert result.passed is False
        assert any("resource_exceeded" in v for v in result.violations)

    @pytest.mark.asyncio
    async def test_time_exceeded(self) -> None:
        """执行时间超限。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(execution_time=500.0)
        result = await reviewer.review_action(event)
        assert result.passed is False


# ---------------------------------------------------------------------------
# 文件类型检测
# ---------------------------------------------------------------------------


class TestFileTypeDetection:
    """文件类型检测。"""

    @pytest.mark.asyncio
    async def test_disallowed_extension(self) -> None:
        """非白名单扩展名触发违宪。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event(file_path="malware.exe")
        result = await reviewer.review_action(event)
        assert result.passed is False
        assert any("file_access_violation" in v for v in result.violations)

    @pytest.mark.asyncio
    async def test_no_file_path_skips_check(self) -> None:
        """无 file_path 时跳过文件检查。"""
        rules = RulesEngine(_make_constitution())
        reviewer = ProcessReviewer(rules)
        event = _make_event()  # 无 file_path
        result = await reviewer.review_action(event)
        # 不应有文件相关的违规
        assert not any("file_access" in v for v in result.violations)
