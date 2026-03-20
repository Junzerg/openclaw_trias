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

        speaker._call_llm = AsyncMock(return_value="请保持冷静")  # type: ignore[method-assign]
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


class TestIntervene:
    """intervene() 控场介入测试。"""

    @pytest.mark.asyncio
    async def test_returns_string(self) -> None:
        """intervene 返回字符串。"""
        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="请保持冷静")  # type: ignore[method-assign]

        result = await speaker.intervene("提案", "批评", 85.0)
        assert isinstance(result, str)

    @pytest.mark.asyncio
    async def test_calls_llm_with_score(self) -> None:
        """intervene 调用 LLM 并传入分歧度。"""
        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="冷静")  # type: ignore[method-assign]

        await speaker.intervene("测试提案", "测试批评", 90.0)
        speaker._call_llm.assert_called_once()  # type: ignore[union-attr]
        call_args = speaker._call_llm.call_args[0][0]  # type: ignore[union-attr]
        assert "90.0" in call_args

    @pytest.mark.asyncio
    async def test_truncates_long_texts(self) -> None:
        """intervene 截断过长的提案/批评文本。"""
        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="OK")  # type: ignore[method-assign]

        long_text = "A" * 500
        await speaker.intervene(long_text, long_text, 85.0)
        call_args = speaker._call_llm.call_args[0][0]  # type: ignore[union-attr]
        # 文本被截断到 200 字符
        assert "A" * 200 in call_args
        assert "A" * 201 not in call_args


class TestGenerateAct:
    """generate_act() 法案生成测试。"""

    @pytest.mark.asyncio
    async def test_generates_act(self) -> None:
        """表决通过后可生成法案。"""
        from openclaw_republic.agents.legislative.debate import (
            DebateResult,
            VoteRecord,
            VoteResult,
        )
        from openclaw_republic.schemas.act import Act

        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="执行步骤")  # type: ignore[method-assign]

        debate_result = DebateResult(
            petition="请实现排序算法",
            rounds=[],
            final_proposal="使用快排实现",
            consensus_reached=True,
            final_conflict_score=20.0,
        )
        vote_result = VoteResult(
            proposal="使用快排实现",
            records=[
                VoteRecord(voter_role="radical_mp", vote=True),
                VoteRecord(voter_role="conservative_mp", vote=True),
            ],
            ayes=2,
            nays=0,
            passed=True,
        )

        act = await speaker.generate_act("请实现排序算法", debate_result, vote_result)
        assert isinstance(act, Act)
        assert len(act.steps) >= 1
        assert act.petition_origin == "请实现排序算法"
        assert act.vote_record.result == "passed"
        assert act.debate_record.total_rounds == 0  # rounds=[] → 0

    @pytest.mark.asyncio
    async def test_raises_when_vote_not_passed(self) -> None:
        """表决未通过时抛出 ValueError。"""
        from openclaw_republic.agents.legislative.debate import (
            DebateResult,
            VoteResult,
        )

        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="")  # type: ignore[method-assign]

        debate_result = DebateResult(
            petition="请愿",
            rounds=[],
            final_proposal="方案",
            consensus_reached=False,
            final_conflict_score=80.0,
        )
        vote_result = VoteResult(
            proposal="方案",
            records=[],
            ayes=0,
            nays=2,
            passed=False,
        )

        with pytest.raises(ValueError, match="表决未通过"):
            await speaker.generate_act("请愿", debate_result, vote_result)

    @pytest.mark.asyncio
    async def test_act_has_valid_uuid(self) -> None:
        """生成的法案 act_id 是有效的 UUID。"""
        import uuid as uuid_mod

        from openclaw_republic.agents.legislative.debate import (
            DebateResult,
            VoteResult,
        )

        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="")  # type: ignore[method-assign]

        debate_result = DebateResult(
            petition="请愿",
            rounds=[],
            final_proposal="方案",
            consensus_reached=True,
            final_conflict_score=10.0,
        )
        vote_result = VoteResult(
            proposal="方案",
            records=[],
            ayes=2,
            nays=0,
            passed=True,
        )

        act = await speaker.generate_act("请愿", debate_result, vote_result)
        # 验证 act_id 是有效 UUID
        parsed = uuid_mod.UUID(act.act_id)
        assert str(parsed) == act.act_id

    @pytest.mark.asyncio
    async def test_voter_positions_mapped(self) -> None:
        """表决记录中的投票立场正确映射。"""
        from openclaw_republic.agents.legislative.debate import (
            DebateResult,
            VoteRecord,
            VoteResult,
        )

        speaker = Speaker()
        speaker._call_llm = AsyncMock(return_value="")  # type: ignore[method-assign]

        debate_result = DebateResult(
            petition="请愿",
            rounds=[],
            final_proposal="方案",
            consensus_reached=True,
            final_conflict_score=10.0,
        )
        vote_result = VoteResult(
            proposal="方案",
            records=[
                VoteRecord(voter_role="radical_mp", vote=True),
                VoteRecord(voter_role="conservative_mp", vote=False),
            ],
            ayes=1,
            nays=1,
            passed=True,  # 强制 passed 测试映射
        )

        act = await speaker.generate_act("请愿", debate_result, vote_result)
        assert act.vote_record.voter_positions["radical_mp"] == "aye"
        assert act.vote_record.voter_positions["conservative_mp"] == "nay"
