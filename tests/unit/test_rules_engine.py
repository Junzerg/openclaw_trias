"""单元测试 — RulesEngine（违宪规则引擎）。"""

from __future__ import annotations

import pytest

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


# ---------------------------------------------------------------------------
# 测试用宪法配置
# ---------------------------------------------------------------------------


def _make_constitution(
    *,
    blacklist: list[str] | None = None,
    allowed_extensions: list[str] | None = None,
    max_tokens: int = 100_000,
    max_time: int = 300,
    max_deviation: float = 0.3,
) -> ConstitutionConfig:
    """创建测试用宪法配置。"""
    return ConstitutionConfig(
        version="1.0-test",
        judicial=JudicialConfig(
            blacklist_commands=blacklist or ["rm -rf", "DROP TABLE", "FORMAT"],
            token_budget=TokenBudgetConfig(
                max_per_task=max_tokens,
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
            allowed_file_extensions=allowed_extensions or [".py", ".js", ".md"],
            max_execution_time_seconds=max_time,
            max_file_size_mb=10,
            network_access="restricted",
        ),
        rbac=RBACConfig(
            permissions=["PLAN", "EXECUTE", "MONITOR", "VETO", "KILL"],
            role_permissions={"chief_justice": ["MONITOR", "KILL"]},
        ),
    )


# ---------------------------------------------------------------------------
# check_command
# ---------------------------------------------------------------------------


class TestCheckCommand:
    """命令黑名单检测。"""

    def test_safe_command(self) -> None:
        """安全命令通过。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_command("ls -la")
        assert result.passed is True

    def test_blacklisted_exact(self) -> None:
        """完全匹配黑名单命令。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_command("rm -rf /")
        assert result.passed is False
        assert "rm -rf" in (result.violation_detail or "")

    def test_blacklisted_embedded(self) -> None:
        """命令中嵌入黑名单子串。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_command("sudo rm -rf /tmp")
        assert result.passed is False

    def test_case_insensitive(self) -> None:
        """大小写不敏感。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_command("drop table users;")
        assert result.passed is False

    def test_non_blacklisted(self) -> None:
        """非黑名单命令通过。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_command("python main.py")
        assert result.passed is True

    def test_all_constitution_blacklist(self) -> None:
        """constitution.yaml 中所有黑名单项均可检测。"""
        engine = RulesEngine(
            _make_constitution(
                blacklist=[
                    "rm -rf",
                    "DROP TABLE",
                    "FORMAT",
                    "deltree",
                    "mkfs",
                    "dd if=",
                    ":(){ :|:& };:",
                    "chmod -R 777",
                    "> /dev/sda",
                ],
            ),
        )
        dangerous = [
            "rm -rf /",
            "DROP TABLE users;",
            "FORMAT C:",
            "deltree C:\\Windows",
            "mkfs /dev/sda1",
            "dd if=/dev/zero of=/dev/sda",
            ":(){ :|:& };:",
            "chmod -R 777 /",
            "> /dev/sda",
        ]
        for cmd in dangerous:
            assert engine.check_command(cmd).passed is False, f"未检测到: {cmd}"


# ---------------------------------------------------------------------------
# check_file_access
# ---------------------------------------------------------------------------


class TestCheckFileAccess:
    """文件扩展名白名单校验。"""

    def test_allowed_extension(self) -> None:
        """白名单扩展名通过。"""
        engine = RulesEngine(_make_constitution())
        assert engine.check_file_access("main.py").passed is True
        assert engine.check_file_access("app.js").passed is True
        assert engine.check_file_access("README.md").passed is True

    def test_disallowed_extension(self) -> None:
        """非白名单扩展名被拒。"""
        engine = RulesEngine(_make_constitution())
        result = engine.check_file_access("malware.exe")
        assert result.passed is False
        assert ".exe" in (result.violation_detail or "")

    def test_no_extension(self) -> None:
        """无扩展名文件通过。"""
        engine = RulesEngine(_make_constitution())
        assert engine.check_file_access("Makefile").passed is True

    def test_nested_path(self) -> None:
        """嵌套路径正确提取扩展名。"""
        engine = RulesEngine(_make_constitution())
        assert engine.check_file_access("/src/lib/utils.py").passed is True
        assert engine.check_file_access("/bin/evil.sh").passed is False


# ---------------------------------------------------------------------------
# check_resource_usage
# ---------------------------------------------------------------------------


class TestCheckResourceUsage:
    """资源超限检测。"""

    def test_within_limits(self) -> None:
        """资源正常时通过。"""
        engine = RulesEngine(_make_constitution(max_tokens=100_000, max_time=300))
        result = engine.check_resource_usage(50_000, 100.0)
        assert result.passed is True

    def test_token_exceeded(self) -> None:
        """Token 超限。"""
        engine = RulesEngine(_make_constitution(max_tokens=10_000))
        result = engine.check_resource_usage(20_000, 10.0)
        assert result.passed is False
        assert "Token" in (result.violation_detail or "")

    def test_time_exceeded(self) -> None:
        """执行时间超限。"""
        engine = RulesEngine(_make_constitution(max_time=60))
        result = engine.check_resource_usage(1_000, 120.0)
        assert result.passed is False
        assert "执行时间" in (result.violation_detail or "")

    def test_exact_limits(self) -> None:
        """恰好等于上限时通过。"""
        engine = RulesEngine(_make_constitution(max_tokens=10_000, max_time=100))
        result = engine.check_resource_usage(10_000, 100.0)
        assert result.passed is True


# ---------------------------------------------------------------------------
# check_deviation
# ---------------------------------------------------------------------------


class TestCheckDeviation:
    """偏离度评估。"""

    @pytest.mark.asyncio
    async def test_default_scorer_low(self) -> None:
        """默认 Mock 评分器返回低偏离度 → 通过。"""
        engine = RulesEngine(_make_constitution(max_deviation=0.3))
        result = await engine.check_deviation("请帮我写代码", "代码输出")
        assert result.passed is True
        assert result.score <= 0.3

    @pytest.mark.asyncio
    async def test_custom_scorer_high(self) -> None:
        """自定义高偏离度评分 → 未通过。"""

        async def high_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 0.9

        engine = RulesEngine(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=high_scorer,
        )
        result = await engine.check_deviation("请帮我写代码", "完全不相关的输出")
        assert result.passed is False
        assert result.score == 0.9

    @pytest.mark.asyncio
    async def test_boundary_score(self) -> None:
        """恰好等于阈值时通过。"""

        async def exact_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 0.3

        engine = RulesEngine(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=exact_scorer,
        )
        result = await engine.check_deviation("test", "test")
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_score_clamped(self) -> None:
        """评分超 1.0 时夹紧到 1.0。"""

        async def overflow_scorer(petition: str, output: str) -> float:
            _ = petition, output
            return 1.5

        engine = RulesEngine(
            _make_constitution(max_deviation=0.3),
            deviation_scorer=overflow_scorer,
        )
        result = await engine.check_deviation("test", "test")
        assert result.score == 1.0
        assert result.passed is False
