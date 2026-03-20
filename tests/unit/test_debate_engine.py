"""单元测试 — DebateEngine 辩论引擎 & VotingMachine 投票机制。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
from openclaw_republic.agents.legislative.debate import (
    DebateEngine,
    DebateResult,
    DebateRound,
    VoteRecord,
    VoteResult,
    VotingMachine,
)
from openclaw_republic.agents.legislative.radical_mp import RadicalMP
from openclaw_republic.agents.legislative.speaker import Speaker
from openclaw_republic.config.models import DebateConfig


def _make_config(
    *,
    max_rounds: int = 5,
    conflict_threshold: int = 80,
    consensus_threshold: int = 30,
    min_rounds: int = 1,
) -> DebateConfig:
    """创建辩论配置的辅助函数。"""
    return DebateConfig(
        max_rounds=max_rounds,
        conflict_threshold=conflict_threshold,
        consensus_threshold=consensus_threshold,
        min_rounds=min_rounds,
    )


# ---------------------------------------------------------------------------
# DebateEngine 测试
# ---------------------------------------------------------------------------


class TestConflictScore:
    """compute_conflict_score() 测试。"""

    def test_within_range(self) -> None:
        """分歧度在 0~100 范围内。"""
        engine = DebateEngine(_make_config())
        score = engine.compute_conflict_score("提案内容 A", "批评内容 B")
        assert 0.0 <= score <= 100.0

    def test_empty_inputs(self) -> None:
        """两个空字符串返回 0。"""
        engine = DebateEngine(_make_config())
        score = engine.compute_conflict_score("", "")
        assert score == 0.0

    def test_identical_length(self) -> None:
        """相同长度文本应产生较低分歧（基线 30）。"""
        engine = DebateEngine(_make_config())
        score = engine.compute_conflict_score("abc", "xyz")
        # 长度相同，diff=0，score = 0/6 * 100 + 30 = 30
        assert score == 30.0

    def test_different_length(self) -> None:
        """不同长度文本分歧度更高。"""
        engine = DebateEngine(_make_config())
        score_same = engine.compute_conflict_score("abc", "xyz")
        score_diff = engine.compute_conflict_score("a", "very long critique text")
        assert score_diff > score_same

    def test_one_empty_caps_at_100(self) -> None:
        """一方为空时分歧度上限为 100。"""
        engine = DebateEngine(_make_config())
        score = engine.compute_conflict_score("", "non-empty text")
        assert score == 100.0
        # 对称性
        score2 = engine.compute_conflict_score("non-empty text", "")
        assert score2 == 100.0


class TestRunDebate:
    """run_debate() 辩论循环测试。"""

    @pytest.mark.asyncio
    async def test_full_debate_returns_result(self) -> None:
        """完整辩论流程返回 DebateResult。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        radical._call_llm = AsyncMock(return_value="激进方案")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="保守批评")  # type: ignore[method-assign]

        config = _make_config(max_rounds=3, min_rounds=1, consensus_threshold=50)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "测试请愿")
        assert isinstance(result, DebateResult)
        assert result.petition == "测试请愿"
        assert len(result.rounds) >= 1

    @pytest.mark.asyncio
    async def test_consensus_terminates_early(self) -> None:
        """共识达成时提前终止辩论。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        # 两者返回相同长度文本 → conflict_score ≈ 30（低于 consensus_threshold=50）
        radical._call_llm = AsyncMock(return_value="同意同意同意")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="也同意同意同")  # type: ignore[method-assign]

        config = _make_config(
            max_rounds=10,
            min_rounds=1,
            consensus_threshold=50,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        # 因为 conflict_score ≈ 30 < 50，第一轮就应达成共识
        assert result.consensus_reached is True
        assert len(result.rounds) == 1

    @pytest.mark.asyncio
    async def test_max_rounds_exhaustion(self) -> None:
        """最大轮次耗尽时终止辩论。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        # 制造持续高分歧 — 差异很大的文本
        radical._call_llm = AsyncMock(return_value="a")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(  # type: ignore[method-assign]
            return_value="这是一段非常非常长的批评文本，用来制造高分歧度",
        )

        config = _make_config(
            max_rounds=3,
            min_rounds=1,
            consensus_threshold=5,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        assert len(result.rounds) == 3

    @pytest.mark.asyncio
    async def test_min_rounds_respected(self) -> None:
        """即使共识达成，也至少完成 min_rounds 轮。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        radical._call_llm = AsyncMock(return_value="同意")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="同意")  # type: ignore[method-assign]

        config = _make_config(
            max_rounds=10,
            min_rounds=3,
            consensus_threshold=50,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        assert len(result.rounds) >= 3

    @pytest.mark.asyncio
    async def test_rounds_have_correct_numbers(self) -> None:
        """每轮辩论的编号递增。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        radical._call_llm = AsyncMock(return_value="x" * 10)  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="y" * 100)  # type: ignore[method-assign]

        config = _make_config(max_rounds=3, min_rounds=1, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        for i, r in enumerate(result.rounds, start=1):
            assert r.round_number == i

    @pytest.mark.asyncio
    async def test_first_round_no_rebuttal(self) -> None:
        """首轮辩论无 rebuttal。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        radical._call_llm = AsyncMock(return_value="提案")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="批评")  # type: ignore[method-assign]

        config = _make_config(max_rounds=1, min_rounds=1, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        assert result.rounds[0].rebuttal == ""

    @pytest.mark.asyncio
    async def test_rebuttal_tracked_across_rounds(self) -> None:
        """后续轮次的 rebuttal 正确记录独立的反驳文本。"""
        speaker = Speaker()
        radical = RadicalMP()
        conservative = ConservativeMP()

        call_count = 0

        async def radical_llm(prompt: str) -> str:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return "初始提案"  # propose
            return f"反驳第{call_count - 1}轮"  # rebut

        radical._call_llm = radical_llm  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(  # type: ignore[method-assign]
            return_value="这是一段非常非常长的批评文本用来保持高分歧度持续辩论下去",
        )

        config = _make_config(max_rounds=3, min_rounds=1, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        assert len(result.rounds) >= 2
        # 首轮无 rebuttal
        assert result.rounds[0].rebuttal == ""
        # 第二轮的 rebuttal 应为 "反驳第1轮"
        assert result.rounds[1].rebuttal == "反驳第1轮"
        # 第二轮的 proposal 应为反驳文本（因为它成了新提案）
        assert result.rounds[1].proposal == "反驳第1轮"


class TestDebateRound:
    """DebateRound 数据模型测试。"""

    def test_creation(self) -> None:
        """DebateRound 可正常创建。"""
        r = DebateRound(
            round_number=1,
            proposal="提案",
            critique="批评",
            rebuttal="反驳",
            conflict_score=45.0,
        )
        assert r.round_number == 1
        assert r.conflict_score == 45.0

    def test_score_validation(self) -> None:
        """conflict_score 超出 0~100 范围应报错。"""
        with pytest.raises(Exception):  # noqa: B017
            DebateRound(
                round_number=1,
                proposal="p",
                critique="c",
                conflict_score=150.0,
            )


class TestDebateResult:
    """DebateResult 数据模型测试。"""

    def test_creation(self) -> None:
        """DebateResult 可正常创建。"""
        result = DebateResult(
            petition="请愿",
            rounds=[],
            final_proposal="最终方案",
            consensus_reached=True,
            final_conflict_score=20.0,
        )
        assert result.consensus_reached is True
        assert result.final_conflict_score == 20.0


# ---------------------------------------------------------------------------
# VotingMachine 测试
# ---------------------------------------------------------------------------


class TestVotingMachine:
    """VotingMachine 投票机制测试。"""

    @pytest.mark.asyncio
    async def test_all_ayes(self) -> None:
        """全部赞成时通过。"""
        radical = RadicalMP()
        conservative = ConservativeMP()
        radical._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]

        machine = VotingMachine()
        result = await machine.tally("提案", [radical, conservative])
        assert result.passed is True
        assert result.ayes == 2
        assert result.nays == 0

    @pytest.mark.asyncio
    async def test_all_nays(self) -> None:
        """全部反对时不通过。"""
        radical = RadicalMP()
        conservative = ConservativeMP()
        radical._call_llm = AsyncMock(return_value="反对")  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(return_value="反对")  # type: ignore[method-assign]

        machine = VotingMachine()
        result = await machine.tally("提案", [radical, conservative])
        assert result.passed is False
        assert result.ayes == 0
        assert result.nays == 2

    @pytest.mark.asyncio
    async def test_mixed_votes(self) -> None:
        """票数不一致时多数方获胜。"""
        r1 = RadicalMP()
        r1._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]
        c1 = ConservativeMP()
        c1._call_llm = AsyncMock(return_value="反对")  # type: ignore[method-assign]
        r2 = RadicalMP()
        r2._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]

        machine = VotingMachine()
        result = await machine.tally("提案", [r1, c1, r2])
        assert result.passed is True
        assert result.ayes == 2
        assert result.nays == 1

    @pytest.mark.asyncio
    async def test_tie_does_not_pass(self) -> None:
        """票数相同时不通过（ayes > nays 才通过）。"""
        r1 = RadicalMP()
        r1._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]
        c1 = ConservativeMP()
        c1._call_llm = AsyncMock(return_value="反对")  # type: ignore[method-assign]

        machine = VotingMachine()
        result = await machine.tally("提案", [r1, c1])
        assert result.passed is False
        assert result.ayes == 1
        assert result.nays == 1

    @pytest.mark.asyncio
    async def test_records_voter_role(self) -> None:
        """投票记录包含正确的 voter_role。"""
        radical = RadicalMP()
        radical._call_llm = AsyncMock(return_value="赞成")  # type: ignore[method-assign]

        machine = VotingMachine()
        result = await machine.tally("提案", [radical])
        assert len(result.records) == 1
        assert result.records[0].voter_role == "radical_mp"
        assert result.records[0].vote is True

    @pytest.mark.asyncio
    async def test_empty_voters(self) -> None:
        """无投票者时不通过。"""
        machine = VotingMachine()
        result = await machine.tally("提案", [])
        assert result.passed is False
        assert result.ayes == 0
        assert result.nays == 0


class TestVoteRecord:
    """VoteRecord 数据模型测试。"""

    def test_creation(self) -> None:
        """VoteRecord 可正常创建。"""
        record = VoteRecord(voter_role="radical_mp", vote=True)
        assert record.voter_role == "radical_mp"
        assert record.vote is True


class TestVoteResult:
    """VoteResult 数据模型测试。"""

    def test_creation(self) -> None:
        """VoteResult 可正常创建。"""
        result = VoteResult(
            proposal="提案",
            records=[],
            ayes=2,
            nays=1,
            passed=True,
        )
        assert result.passed is True
        assert result.ayes == 2
