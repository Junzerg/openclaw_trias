"""单元测试 — DebateEngine 辩论引擎 & VotingMachine 投票机制。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from openclaw_republic.agents.legislative.conflict_score import ConflictScoreEngine
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


def _make_agents(
    *,
    radical_response: str = "激进方案",
    conservative_response: str = "保守批评",
    speaker_response: str = "",
) -> tuple[Speaker, RadicalMP, ConservativeMP]:
    """创建 mock 过的 Agent 三件套。"""
    speaker = Speaker()
    radical = RadicalMP()
    conservative = ConservativeMP()

    speaker._call_llm = AsyncMock(return_value=speaker_response)  # type: ignore[method-assign]
    radical._call_llm = AsyncMock(return_value=radical_response)  # type: ignore[method-assign]
    conservative._call_llm = AsyncMock(return_value=conservative_response)  # type: ignore[method-assign]

    return speaker, radical, conservative


# ---------------------------------------------------------------------------
# DebateEngine 辩论流程测试
# ---------------------------------------------------------------------------


class TestRunDebate:
    """run_debate() 辩论循环测试。"""

    @pytest.mark.asyncio
    async def test_full_debate_returns_result(self) -> None:
        """完整辩论流程返回 DebateResult。"""
        speaker, radical, conservative = _make_agents()

        config = _make_config(max_rounds=3, min_rounds=1, consensus_threshold=50)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "测试请愿")
        assert isinstance(result, DebateResult)
        assert result.petition == "测试请愿"
        assert len(result.rounds) >= 1

    @pytest.mark.asyncio
    async def test_consensus_terminates_early(self) -> None:
        """共识达成时提前终止辩论。"""
        # 使用妥协语言降低分歧度
        speaker, radical, conservative = _make_agents(
            radical_response="部分同意，可以考虑折中方案，接受",
            conservative_response="有道理，部分同意，可以考虑接受这个方案",
        )

        config = _make_config(
            max_rounds=10,
            min_rounds=1,
            consensus_threshold=50,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        # 妥协信号多，分歧度低，第一轮就应达成共识
        assert result.consensus_reached is True
        assert len(result.rounds) == 1

    @pytest.mark.asyncio
    async def test_max_rounds_exhaustion(self) -> None:
        """最大轮次耗尽时终止辩论。"""
        # 使用对抗性语言保持高分歧
        speaker, radical, conservative = _make_agents(
            radical_response="绝对反对！不可能！",
            conservative_response="反对！不同意！荒谬！错误！危险！必须拒绝！",
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
        speaker, radical, conservative = _make_agents(
            radical_response="部分同意，可以考虑，有道理，接受折中",
            conservative_response="部分同意，可以考虑，有道理，接受折中",
        )

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
        speaker, radical, conservative = _make_agents(
            radical_response="绝对反对！不可能！",
            conservative_response="反对！不同意！荒谬！错误！",
        )

        config = _make_config(max_rounds=3, min_rounds=1, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        for i, r in enumerate(result.rounds, start=1):
            assert r.round_number == i

    @pytest.mark.asyncio
    async def test_first_round_no_rebuttal(self) -> None:
        """首轮辩论无 rebuttal。"""
        speaker, radical, conservative = _make_agents()

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

        speaker._call_llm = AsyncMock(return_value="请冷静")  # type: ignore[method-assign]
        radical._call_llm = radical_llm  # type: ignore[method-assign]
        conservative._call_llm = AsyncMock(  # type: ignore[method-assign]
            return_value="反对！不同意！荒谬！错误！危险！绝对不行！必须拒绝！",
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


# ---------------------------------------------------------------------------
# ConflictScoreEngine 集成测试
# ---------------------------------------------------------------------------


class TestConflictScoreIntegration:
    """DebateEngine 中 ConflictScoreEngine 集成测试。"""

    def test_engine_has_conflict_engine(self) -> None:
        """DebateEngine 包含 ConflictScoreEngine 实例。"""
        engine = DebateEngine(_make_config())
        assert isinstance(engine._conflict_engine, ConflictScoreEngine)

    @pytest.mark.asyncio
    async def test_conflict_scores_recorded(self) -> None:
        """每轮辩论记录分歧度。"""
        speaker, radical, conservative = _make_agents()

        config = _make_config(max_rounds=2, min_rounds=2, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        for r in result.rounds:
            assert 0.0 <= r.conflict_score <= 100.0

    @pytest.mark.asyncio
    async def test_conflict_trend_computed(self) -> None:
        """多轮辩论后计算分歧度趋势。"""
        speaker, radical, conservative = _make_agents(
            radical_response="绝对反对！",
            conservative_response="反对！不同意！错误！",
        )

        config = _make_config(max_rounds=3, min_rounds=2, consensus_threshold=5)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        if len(result.rounds) >= 2:
            assert result.conflict_trend is not None
            assert result.conflict_trend.direction in (
                "converging",
                "diverging",
                "stable",
            )

    @pytest.mark.asyncio
    async def test_single_round_no_trend(self) -> None:
        """单轮辩论无趋势。"""
        speaker, radical, conservative = _make_agents(
            radical_response="部分同意 可以考虑 有道理 接受 折中 妥协",
            conservative_response="部分同意 可以考虑 有道理 接受 折中 妥协",
        )

        config = _make_config(max_rounds=5, min_rounds=1, consensus_threshold=50)
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        if len(result.rounds) == 1:
            assert result.conflict_trend is None


# ---------------------------------------------------------------------------
# 议长控场测试
# ---------------------------------------------------------------------------


class TestSpeakerIntervention:
    """议长控场触发测试。"""

    @pytest.mark.asyncio
    async def test_intervention_when_high_conflict(self) -> None:
        """分歧度超过控场阈值时议长介入。"""
        speaker, radical, conservative = _make_agents(
            radical_response="绝对反对！",
            conservative_response="反对！不同意！荒谬！错误！危险！必须拒绝！绝对不行！极其严重！",
            speaker_response="请双方保持冷静，理性讨论",
        )

        config = _make_config(
            max_rounds=2,
            min_rounds=1,
            conflict_threshold=30,  # 低阈值，容易触发控场
            consensus_threshold=5,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        # 至少有一轮应有控场声明
        interventions = [
            r.speaker_intervention for r in result.rounds if r.speaker_intervention is not None
        ]
        assert len(interventions) > 0

    @pytest.mark.asyncio
    async def test_no_intervention_when_low_conflict(self) -> None:
        """分歧度低于控场阈值时无控场。"""
        speaker, radical, conservative = _make_agents(
            radical_response="部分同意 可以考虑 有道理 接受 折中",
            conservative_response="部分同意 可以考虑 有道理 接受 折中",
        )

        config = _make_config(
            max_rounds=2,
            min_rounds=2,
            conflict_threshold=95,  # 高阈值，不容易触发
            consensus_threshold=5,
        )
        engine = DebateEngine(config)

        result = await engine.run_debate(speaker, radical, conservative, "请愿")
        interventions = [
            r.speaker_intervention for r in result.rounds if r.speaker_intervention is not None
        ]
        assert len(interventions) == 0


# ---------------------------------------------------------------------------
# DebateRound / DebateResult 模型测试
# ---------------------------------------------------------------------------


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
        assert r.speaker_intervention is None

    def test_with_intervention(self) -> None:
        """DebateRound 可包含控场声明。"""
        r = DebateRound(
            round_number=1,
            proposal="提案",
            critique="批评",
            conflict_score=85.0,
            speaker_intervention="请保持冷静",
        )
        assert r.speaker_intervention == "请保持冷静"

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
        assert result.conflict_trend is None


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
