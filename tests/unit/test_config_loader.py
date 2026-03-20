"""单元测试 — constitution.yaml 配置加载 & Pydantic 校验。"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from openclaw_republic.config.loader import load_constitution
from openclaw_republic.config.models import (
    ConstitutionConfig,
    DebateConfig,
    DeviationConfig,
    JudicialConfig,
    RBACConfig,
    SecurityConfig,
    TokenBudgetConfig,
)

# 项目根目录下的 constitution.yaml 路径
CONSTITUTION_PATH = Path(__file__).resolve().parents[2] / "config" / "constitution.yaml"


class TestLoadConstitution:
    """测试 constitution.yaml 加载。"""

    def test_load_returns_config_instance(self) -> None:
        """load_constitution() 返回 ConstitutionConfig 实例。"""
        config = load_constitution(CONSTITUTION_PATH)
        assert isinstance(config, ConstitutionConfig)

    def test_version(self) -> None:
        """版本号正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        assert config.version == "1.0"

    def test_judicial_config(self) -> None:
        """司法配置正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        assert isinstance(config.judicial, JudicialConfig)
        assert "rm -rf" in config.judicial.blacklist_commands
        assert len(config.judicial.blacklist_commands) >= 5

    def test_token_budget(self) -> None:
        """Token 预算正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        budget = config.judicial.token_budget
        assert isinstance(budget, TokenBudgetConfig)
        assert budget.max_per_task == 100000
        assert budget.debate_budget == 30000
        assert budget.execution_budget == 50000
        assert budget.review_budget == 20000

    def test_debate_config(self) -> None:
        """辩论配置正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        debate = config.judicial.debate
        assert isinstance(debate, DebateConfig)
        assert debate.max_rounds == 10
        assert debate.conflict_threshold == 80
        assert debate.consensus_threshold == 30
        assert debate.min_rounds == 2

    def test_deviation_config(self) -> None:
        """偏离度配置正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        deviation = config.judicial.deviation
        assert isinstance(deviation, DeviationConfig)
        assert deviation.max_score == 0.3

    def test_security_config(self) -> None:
        """安全配置正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        security = config.security
        assert isinstance(security, SecurityConfig)
        assert security.sandbox_enabled is True
        assert ".py" in security.allowed_file_extensions
        assert security.max_execution_time_seconds == 300
        assert security.network_access == "restricted"

    def test_rbac_config(self) -> None:
        """RBAC 权限配置正确加载。"""
        config = load_constitution(CONSTITUTION_PATH)
        rbac = config.rbac
        assert isinstance(rbac, RBACConfig)
        assert "PLAN" in rbac.permissions
        assert "EXECUTE" in rbac.permissions
        assert "MONITOR" in rbac.permissions
        assert "VETO" in rbac.permissions
        assert "KILL" in rbac.permissions
        assert rbac.role_permissions["speaker"] == ["PLAN"]
        assert rbac.role_permissions["chief_justice"] == ["MONITOR", "KILL"]

    def test_file_not_found(self) -> None:
        """不存在的文件抛出 FileNotFoundError。"""
        with pytest.raises(FileNotFoundError):
            load_constitution("nonexistent/path.yaml")


class TestValidationConstraints:
    """测试 Pydantic 字段约束。"""

    def test_conflict_threshold_out_of_range(self) -> None:
        """conflict_threshold 超出 0~100 范围抛出 ValidationError。"""
        with pytest.raises(ValidationError):
            DebateConfig(
                max_rounds=5,
                conflict_threshold=150,  # 超出范围
                consensus_threshold=30,
                min_rounds=2,
            )

    def test_max_score_out_of_range(self) -> None:
        """max_score 超出 0~1 范围抛出 ValidationError。"""
        with pytest.raises(ValidationError):
            DeviationConfig(max_score=1.5)

    def test_token_budget_too_low(self) -> None:
        """Token 预算低于下限抛出 ValidationError。"""
        with pytest.raises(ValidationError):
            TokenBudgetConfig(
                max_per_task=100,  # 低于 1000
                debate_budget=500,
                execution_budget=500,
                review_budget=500,
            )

    def test_negative_rounds(self) -> None:
        """辩论轮次为负数抛出 ValidationError。"""
        with pytest.raises(ValidationError):
            DebateConfig(
                max_rounds=-1,
                conflict_threshold=80,
                consensus_threshold=30,
                min_rounds=1,
            )

    def test_min_rounds_exceeds_max_rounds(self) -> None:
        """min_rounds > max_rounds 抛出 ValidationError。"""
        with pytest.raises(ValidationError):
            DebateConfig(
                max_rounds=3,
                conflict_threshold=80,
                consensus_threshold=30,
                min_rounds=5,
            )
