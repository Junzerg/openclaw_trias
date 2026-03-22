"""单元测试 — RBAC 权限校验。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.base import (
    BaseAgent,
    Branch,
    Permission,
    PermissionDeniedError,
)


class TestPermissionEnum:
    """Permission 枚举测试。"""

    def test_has_five_members(self) -> None:
        """Permission 包含 5 种权限。"""
        assert len(Permission) == 5

    def test_member_names(self) -> None:
        """各成员名称正确。"""
        expected = {"PLAN", "EXECUTE", "MONITOR", "VETO", "KILL"}
        assert {p.name for p in Permission} == expected

    def test_member_values(self) -> None:
        """各成员值与 constitution.yaml RBAC 矩阵一致。"""
        assert Permission.PLAN.value == "PLAN"
        assert Permission.EXECUTE.value == "EXECUTE"
        assert Permission.MONITOR.value == "MONITOR"
        assert Permission.VETO.value == "VETO"
        assert Permission.KILL.value == "KILL"

    def test_is_str_enum(self) -> None:
        """Permission 是 str 枚举，可直接用于字符串比较。"""
        assert Permission.PLAN == "PLAN"


class TestBranchEnum:
    """Branch 枚举测试。"""

    def test_has_three_members(self) -> None:
        """Branch 包含 3 个分支。"""
        assert len(Branch) == 3

    def test_member_values(self) -> None:
        """各分支值正确。"""
        assert Branch.LEGISLATIVE.value == "legislative"
        assert Branch.EXECUTIVE.value == "executive"
        assert Branch.JUDICIAL.value == "judicial"


class TestHasPermission:
    """has_permission() 测试。"""

    def test_returns_true_for_granted(self) -> None:
        """拥有的权限返回 True。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert agent.has_permission(Permission.PLAN) is True

    def test_returns_false_for_denied(self) -> None:
        """未拥有的权限返回 False。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert agent.has_permission(Permission.EXECUTE) is False

    def test_multiple_permissions(self) -> None:
        """多权限组合正确。"""
        agent = BaseAgent(
            name="总统",
            role="president",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN, Permission.VETO},
        )
        assert agent.has_permission(Permission.PLAN) is True
        assert agent.has_permission(Permission.VETO) is True
        assert agent.has_permission(Permission.EXECUTE) is False


class TestRequirePermission:
    """require_permission() 测试。"""

    def test_passes_for_granted(self) -> None:
        """拥有权限时不抛异常。"""
        agent = BaseAgent(
            name="总统",
            role="president",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN, Permission.VETO},
        )
        agent.require_permission(Permission.PLAN)  # 不应抛异常

    def test_raises_for_denied(self) -> None:
        """权限不足时抛出 PermissionDeniedError。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        with pytest.raises(PermissionDeniedError, match="EXECUTE"):
            agent.require_permission(Permission.EXECUTE)

    def test_legislative_cannot_execute(self) -> None:
        """立法 Agent 调用 require_permission(EXECUTE) 抛异常。"""
        agent = BaseAgent(
            name="激进派",
            role="radical_mp",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        with pytest.raises(PermissionDeniedError):
            agent.require_permission(Permission.EXECUTE)

    def test_executive_cannot_plan(self) -> None:
        """行政 Agent (纯 EXECUTE) 调用 require_permission(PLAN) 抛异常。"""
        agent = BaseAgent(
            name="工程部长",
            role="sec_engineering",
            branch=Branch.EXECUTIVE,
            permissions={Permission.EXECUTE},
        )
        with pytest.raises(PermissionDeniedError):
            agent.require_permission(Permission.PLAN)

    def test_error_message_contains_role(self) -> None:
        """错误消息包含角色名。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        with pytest.raises(PermissionDeniedError, match="speaker"):
            agent.require_permission(Permission.KILL)


class TestPermissionsImmutable:
    """权限集不可变性测试。"""

    def test_permissions_frozen(self) -> None:
        """_permissions 是 frozenset，运行时不可更改。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert isinstance(agent._permissions, frozenset)
