# mypy: ignore-errors
"""单元测试 — ConservativeMP 保守派议员 Agent。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from openclaw_republic.agents.base import Branch, Permission, PermissionDeniedError
from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
from openclaw_republic.config.loader import soul_cache

SOULS_DIR = Path(__file__).resolve().parents[2] / "config" / "souls"


class TestConservativeMPInit:
    """ConservativeMP 初始化测试。"""

    def test_branch_is_legislative(self) -> None:
        """保守派属于立法分支。"""
        mp = ConservativeMP()
        assert mp.branch == Branch.LEGISLATIVE

    def test_permissions_is_plan(self) -> None:
        """保守派仅拥有 PLAN 权限。"""
        mp = ConservativeMP()
        assert mp.has_permission(Permission.PLAN)
        assert not mp.has_permission(Permission.EXECUTE)
        assert not mp.has_permission(Permission.VETO)

    def test_role(self) -> None:
        """角色标识为 conservative_mp。"""
        mp = ConservativeMP()
        assert mp.role == "conservative_mp"

    def test_name(self) -> None:
        """名称为 Conservative MP。"""
        mp = ConservativeMP()
        assert mp.name == "Conservative MP"


class TestConservativeMPSoul:
    """ConservativeMP SOUL.md 加载测试。"""

    def setup_method(self) -> None:
        """每个测试前清除缓存。"""
        soul_cache.invalidate()

    def test_loads_soul(self) -> None:
        """加载真实 SOUL.md 后 system_prompt 非空。"""
        mp = ConservativeMP(soul_path=SOULS_DIR / "conservative_mp.md")
        assert len(mp.system_prompt) > 0

    def test_system_prompt_content(self) -> None:
        """system_prompt 包含保守派相关内容。"""
        mp = ConservativeMP(soul_path=SOULS_DIR / "conservative_mp.md")
        assert "Conservative" in mp.system_prompt or "保守" in mp.system_prompt

    def test_no_soul_empty_prompt(self) -> None:
        """未指定 soul 时 prompt 为空。"""
        mp = ConservativeMP()
        assert mp.system_prompt == ""


class TestConservativeMPRBAC:
    """ConservativeMP RBAC 测试。"""

    def test_cannot_execute(self) -> None:
        """保守派不能执行 EXECUTE 操作。"""
        mp = ConservativeMP()
        with pytest.raises(PermissionDeniedError):
            mp.require_permission(Permission.EXECUTE)

    def test_cannot_kill(self) -> None:
        """保守派不能行使熔断权。"""
        mp = ConservativeMP()
        with pytest.raises(PermissionDeniedError):
            mp.require_permission(Permission.KILL)


class TestCritique:
    """critique() 测试。"""

    @pytest.mark.asyncio
    async def test_calls_llm(self) -> None:
        """critique 调用 _call_llm 并返回结果。"""
        mp = ConservativeMP()
        mp._call_llm = AsyncMock(return_value="这个方案有 3 个安全漏洞")  # type: ignore[method-assign]
        result = await mp.critique("使用最新框架重写")
        assert result == "这个方案有 3 个安全漏洞"
        mp._call_llm.assert_called_once()  # type: ignore[union-attr]

    @pytest.mark.asyncio
    async def test_prompt_contains_proposal(self) -> None:
        """传给 _call_llm 的 prompt 包含提案内容。"""
        mp = ConservativeMP()
        captured_prompt = ""

        async def mock_llm(prompt: str) -> str:
            nonlocal captured_prompt
            captured_prompt = prompt
            return "审查意见"

        mp._call_llm = mock_llm  # type: ignore[method-assign]
        await mp.critique("使用 GraphQL 替换 REST")
        assert "使用 GraphQL 替换 REST" in captured_prompt


class TestConservativeRebut:
    """rebut() 测试。"""

    @pytest.mark.asyncio
    async def test_calls_llm(self) -> None:
        """rebut 调用 _call_llm 并返回结果。"""
        mp = ConservativeMP()
        mp._call_llm = AsyncMock(return_value="生产环境需要可靠性")  # type: ignore[method-assign]
        result = await mp.rebut("你的担忧是多余的")
        assert result == "生产环境需要可靠性"


class TestConservativeVote:
    """vote() 测试。"""

    @pytest.mark.asyncio
    async def test_vote_yes(self) -> None:
        """LLM 返回包含'赞成'时投赞成票。"""
        mp = ConservativeMP()
        mp._call_llm = AsyncMock(return_value="附带条件地赞成")  # type: ignore[method-assign]
        assert await mp.vote("提案内容") is True

    @pytest.mark.asyncio
    async def test_vote_no(self) -> None:
        """LLM 返回不含'赞成'时投反对票。"""
        mp = ConservativeMP()
        mp._call_llm = AsyncMock(return_value="坚决反对")  # type: ignore[method-assign]
        assert await mp.vote("提案内容") is False
