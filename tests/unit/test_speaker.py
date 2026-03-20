"""单元测试 — Speaker 议长 Agent。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from openclaw_republic.agents.base import Branch, Permission, PermissionDeniedError
from openclaw_republic.agents.legislative.speaker import Speaker
from openclaw_republic.config.loader import soul_cache

SOULS_DIR = Path(__file__).resolve().parents[2] / "config" / "souls"


class TestSpeakerInit:
    """Speaker 初始化测试。"""

    def test_branch_is_legislative(self) -> None:
        """议长属于立法分支。"""
        speaker = Speaker()
        assert speaker.branch == Branch.LEGISLATIVE

    def test_permissions_is_plan(self) -> None:
        """议长仅拥有 PLAN 权限。"""
        speaker = Speaker()
        assert speaker.has_permission(Permission.PLAN)
        assert not speaker.has_permission(Permission.EXECUTE)
        assert not speaker.has_permission(Permission.VETO)
        assert not speaker.has_permission(Permission.MONITOR)
        assert not speaker.has_permission(Permission.KILL)

    def test_role_is_speaker(self) -> None:
        """角色标识为 speaker。"""
        speaker = Speaker()
        assert speaker.role == "speaker"

    def test_name_is_speaker(self) -> None:
        """名称为 Speaker。"""
        speaker = Speaker()
        assert speaker.name == "Speaker"

    def test_no_petition_initially(self) -> None:
        """初始无请愿。"""
        speaker = Speaker()
        assert speaker._current_petition is None


class TestSpeakerSoul:
    """Speaker SOUL.md 加载测试。"""

    def setup_method(self) -> None:
        """每个测试前清除缓存。"""
        soul_cache.invalidate()

    def test_loads_soul(self) -> None:
        """加载真实 SOUL.md 后 system_prompt 非空。"""
        speaker = Speaker(soul_path=SOULS_DIR / "speaker.md")
        assert len(speaker.system_prompt) > 0

    def test_system_prompt_contains_speaker(self) -> None:
        """system_prompt 包含 Speaker 相关内容。"""
        speaker = Speaker(soul_path=SOULS_DIR / "speaker.md")
        assert "Speaker" in speaker.system_prompt or "议长" in speaker.system_prompt

    def test_no_soul_empty_prompt(self) -> None:
        """未指定 soul_path 时 system_prompt 为空。"""
        speaker = Speaker()
        assert speaker.system_prompt == ""


class TestSpeakerRBAC:
    """Speaker RBAC 权限测试。"""

    def test_cannot_execute(self) -> None:
        """议长不能执行 EXECUTE 操作。"""
        speaker = Speaker()
        with pytest.raises(PermissionDeniedError):
            speaker.require_permission(Permission.EXECUTE)

    def test_cannot_veto(self) -> None:
        """议长不能行使否决权。"""
        speaker = Speaker()
        with pytest.raises(PermissionDeniedError):
            speaker.require_permission(Permission.VETO)

    def test_cannot_kill(self) -> None:
        """议长不能行使熔断权。"""
        speaker = Speaker()
        with pytest.raises(PermissionDeniedError):
            speaker.require_permission(Permission.KILL)


class TestReceivePetition:
    """receive_petition() 测试。"""

    @pytest.mark.asyncio
    async def test_stores_petition(self) -> None:
        """接收请愿后存储。"""
        speaker = Speaker()
        await speaker.receive_petition("请实现一个排序算法")
        assert speaker._current_petition == "请实现一个排序算法"

    @pytest.mark.asyncio
    async def test_overwrites_previous(self) -> None:
        """新请愿覆盖旧请愿。"""
        speaker = Speaker()
        await speaker.receive_petition("请愿 A")
        await speaker.receive_petition("请愿 B")
        assert speaker._current_petition == "请愿 B"


class TestModerateDebate:
    """moderate_debate() 测试。"""

    @pytest.mark.asyncio
    async def test_raises_without_petition(self) -> None:
        """未接收请愿时调用 moderate_debate 抛出 ValueError。"""
        from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
        from openclaw_republic.agents.legislative.radical_mp import RadicalMP
        from openclaw_republic.config.models import DebateConfig

        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()
        config = DebateConfig(
            max_rounds=3,
            conflict_threshold=80,
            consensus_threshold=30,
            min_rounds=1,
        )

        with pytest.raises(ValueError, match="尚未接收选民请愿"):
            await speaker.moderate_debate(radical, conservative, config)

    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        """接收请愿后 moderate_debate 正常返回 DebateResult。"""
        from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
        from openclaw_republic.agents.legislative.debate import DebateResult
        from openclaw_republic.agents.legislative.radical_mp import RadicalMP
        from openclaw_republic.config.models import DebateConfig

        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        radical._call_llm = AsyncMock(return_value="激进方案内容在此")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="保守批评内容在此")  # type: ignore[method-assign]

        config = DebateConfig(
            max_rounds=3,
            conflict_threshold=80,
            consensus_threshold=50,
            min_rounds=1,
        )

        await speaker.receive_petition("请实现缓存层")
        result = await speaker.moderate_debate(radical, conservative, config)
        assert isinstance(result, DebateResult)
        assert result.petition == "请实现缓存层"
        assert len(result.rounds) >= 1


class TestCallVote:
    """call_vote() 测试。"""

    @pytest.mark.asyncio
    async def test_returns_vote_result(self) -> None:
        """call_vote 返回 VoteResult。"""
        from openclaw_republic.agents.legislative.debate import VoteResult
        from openclaw_republic.agents.legislative.radical_mp import RadicalMP

        speaker = Speaker()
        r1 = RadicalMP()
        r2 = RadicalMP()
        r1._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]
        r2._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]

        result = await speaker.call_vote("提案内容", [r1, r2])
        assert isinstance(result, VoteResult)
        assert result.ayes == 2
        assert result.nays == 0
        assert result.passed is True
