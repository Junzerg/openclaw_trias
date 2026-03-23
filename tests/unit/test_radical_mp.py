# mypy: ignore-errors
"""单元测试 — RadicalMP 激进派议员 Agent。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from openclaw_republic.agents.base import Branch, Permission, PermissionDeniedError
from openclaw_republic.agents.legislative.radical_mp import RadicalMP
from openclaw_republic.config.loader import soul_cache

SOULS_DIR = Path(__file__).resolve().parents[2] / "config" / "souls"


class TestRadicalMPInit:
    """RadicalMP 初始化测试。"""

    def test_branch_is_legislative(self) -> None:
        """激进派属于立法分支。"""
        mp = RadicalMP()
        assert mp.branch == Branch.LEGISLATIVE

    def test_permissions_is_plan(self) -> None:
        """激进派仅拥有 PLAN 权限。"""
        mp = RadicalMP()
        assert mp.has_permission(Permission.PLAN)
        assert not mp.has_permission(Permission.EXECUTE)
        assert not mp.has_permission(Permission.VETO)

    def test_role(self) -> None:
        """角色标识为 radical_mp。"""
        mp = RadicalMP()
        assert mp.role == "radical_mp"

    def test_name(self) -> None:
        """名称为 Radical MP。"""
        mp = RadicalMP()
        assert mp.name == "Radical MP"


class TestRadicalMPSoul:
    """RadicalMP SOUL.md 加载测试。"""

    def setup_method(self) -> None:
        """每个测试前清除缓存。"""
        soul_cache.invalidate()

    def test_loads_soul(self) -> None:
        """加载真实 SOUL.md 后 system_prompt 非空。"""
        mp = RadicalMP(soul_path=SOULS_DIR / "radical_mp.md")
        assert len(mp.system_prompt) > 0

    def test_system_prompt_content(self) -> None:
        """system_prompt 包含激进派相关内容。"""
        mp = RadicalMP(soul_path=SOULS_DIR / "radical_mp.md")
        assert "Radical" in mp.system_prompt or "激进" in mp.system_prompt

    def test_no_soul_empty_prompt(self) -> None:
        """未指定 soul 时 prompt 为空。"""
        mp = RadicalMP()
        assert mp.system_prompt == ""


class TestRadicalMPRBAC:
    """RadicalMP RBAC 测试。"""

    def test_cannot_execute(self) -> None:
        """激进派不能执行 EXECUTE 操作。"""
        mp = RadicalMP()
        with pytest.raises(PermissionDeniedError):
            mp.require_permission(Permission.EXECUTE)

    def test_cannot_kill(self) -> None:
        """激进派不能行使熔断权。"""
        mp = RadicalMP()
        with pytest.raises(PermissionDeniedError):
            mp.require_permission(Permission.KILL)


class TestPropose:
    """propose() 测试。"""

    @pytest.mark.asyncio
    async def test_calls_llm(self) -> None:
        """propose 调用 _call_llm 并返回结果。"""
        mp = RadicalMP()
        mp._call_llm = AsyncMock(return_value="使用 Rust 重写核心模块")  # type: ignore[method-assign]
        result = await mp.propose("请优化系统性能")
        assert result == "使用 Rust 重写核心模块"
        mp._call_llm.assert_called_once()  # type: ignore[union-attr]

    @pytest.mark.asyncio
    async def test_prompt_contains_petition(self) -> None:
        """传给 _call_llm 的 prompt 包含请愿内容。"""
        mp = RadicalMP()
        captured_prompt = ""

        async def mock_llm(prompt: str) -> str:
            nonlocal captured_prompt
            captured_prompt = prompt
            return "方案"

        mp._call_llm = mock_llm  # type: ignore[method-assign]
        await mp.propose("优化数据库查询")
        assert "优化数据库查询" in captured_prompt


class TestRebut:
    """rebut() 测试。"""

    @pytest.mark.asyncio
    async def test_calls_llm(self) -> None:
        """rebut 调用 _call_llm 并返回结果。"""
        mp = RadicalMP()
        mp._call_llm = AsyncMock(return_value="你的担忧是多余的")  # type: ignore[method-assign]
        result = await mp.rebut("这个方案有安全风险")
        assert result == "你的担忧是多余的"


class TestVote:
    """vote() 测试。"""

    @pytest.mark.asyncio
    async def test_vote_yes(self) -> None:
        """LLM 返回包含'赞成'的文本时投赞成票。"""
        mp = RadicalMP()
        mp._call_llm = AsyncMock(return_value="我赞成这个提案")  # type: ignore[method-assign]
        assert await mp.vote("提案内容") is True

    @pytest.mark.asyncio
    async def test_vote_no(self) -> None:
        """LLM 返回不含'赞成'的文本时投反对票。"""
        mp = RadicalMP()
        mp._call_llm = AsyncMock(return_value="我反对这个提案")  # type: ignore[method-assign]
        assert await mp.vote("提案内容") is False

    @pytest.mark.asyncio
    async def test_vote_yes_english(self) -> None:
        """LLM 返回包含 'yes' 的文本时投赞成票。"""
        mp = RadicalMP()
        mp._call_llm = AsyncMock(return_value="Yes, I agree")  # type: ignore[method-assign]
        assert await mp.vote("proposal") is True
