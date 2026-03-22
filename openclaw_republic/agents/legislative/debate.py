"""议会辩论协议 — 多轮 Critique → Rebuttal → 共识表决。

包含：辩论引擎 (DebateEngine)、投票机制 (VotingMachine)、
以及辩论结果数据模型 (DebateRound, DebateResult, VoteRecord, VoteResult)。

Conflict Score 由 ConflictScoreEngine 计算，基于规则引擎实现。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from openclaw_republic.schemas.events import EventAction
from openclaw_republic.agents.legislative.conflict_score import (
    ConflictScoreEngine,
    ConflictTrend,
)

if TYPE_CHECKING:
    from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
    from openclaw_republic.agents.legislative.radical_mp import RadicalMP
    from openclaw_republic.agents.legislative.speaker import Speaker
    from openclaw_republic.config.models import DebateConfig


# ---------------------------------------------------------------------------
# 投票协议 — 所有可投票的 Agent 需实现此协议
# ---------------------------------------------------------------------------


@runtime_checkable
class Voter(Protocol):
    """可投票的 Agent 协议。"""

    role: str

    async def vote(self, proposal: str) -> bool:
        """对提案投票。"""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class DebateRound(BaseModel):
    """单轮辩论记录。"""

    round_number: int = Field(ge=1, description="辩论轮次编号")
    proposal: str = Field(
        description="当前轮次的立场文本（首轮为提案，后续为反驳）",
    )
    critique: str = Field(description="保守派批评/二次论证内容")
    rebuttal: str = Field(default="", description="激进派反驳内容（首轮为空）")
    conflict_score: float = Field(ge=0.0, le=100.0, description="本轮分歧度")
    speaker_intervention: str | None = Field(
        default=None,
        description="议长控场声明（仅在分歧度超过控场阈值时出现）",
    )


class DebateResult(BaseModel):
    """辩论最终结果。"""

    petition: str = Field(description="原始选民请愿")
    rounds: list[DebateRound] = Field(description="各轮辩论记录")
    final_proposal: str = Field(description="最终提案文本")
    consensus_reached: bool = Field(description="是否达成共识")
    final_conflict_score: float = Field(ge=0.0, le=100.0, description="最终分歧度")
    conflict_trend: ConflictTrend | None = Field(
        default=None,
        description="分歧度趋势（至少 2 轮辩论后可用）",
    )


class VoteRecord(BaseModel):
    """单票记录。"""

    voter_role: str = Field(description="投票者角色名")
    vote: bool = Field(description="True=赞成, False=反对")


class VoteResult(BaseModel):
    """投票结果汇总。"""

    proposal: str = Field(description="被表决的提案")
    records: list[VoteRecord] = Field(description="投票记录")
    ayes: int = Field(ge=0, description="赞成票数")
    nays: int = Field(ge=0, description="反对票数")
    passed: bool = Field(description="是否通过（简单多数制）")


# ---------------------------------------------------------------------------
# DebateEngine
# ---------------------------------------------------------------------------


class DebateEngine:
    """议会辩论引擎 — 管理辩论流程。

    负责：辩论轮次管理、发言调度、conflict_score 计算、
    终止条件判定、议长控场触发。
    """

    def __init__(self, config: DebateConfig) -> None:
        """初始化辩论引擎。

        Args:
            config: 辩论规则配置（来自 constitution.yaml）。
        """
        self._config = config
        self._conflict_engine = ConflictScoreEngine()

    async def run_debate(
        self,
        speaker: Speaker,
        radical: RadicalMP,
        conservative: ConservativeMP,
        petition: str,
        event_publisher: Any | None = None,
    ) -> DebateResult:
        """执行完整辩论流程。

        流程：
        1. 激进派针对请愿提出提案
        2. 保守派对提案进行 critique
        3. 计算 conflict_score
        4. 如分歧度超过控场阈值，议长介入发出冷静声明
        5. 如未达共识且未达最大轮次：
           激进派 rebut → 保守派再 critique → 重新计算
        6. 共识或轮次耗尽时终止，计算趋势

        Args:
            speaker: 议长（用于控场介入）。
            radical: 激进派议员。
            conservative: 保守派议员。
            petition: 选民请愿内容。

        Returns:
            辩论结果。
        """
        rounds: list[DebateRound] = []
        score_history: list[float] = []
        current_proposal = await radical.propose(petition)
        
        if event_publisher:
            await event_publisher(EventAction.PROPOSE, agent="radical_mp", text=current_proposal, round_number=1, conflict_score=0.0)
            
        last_rebuttal = ""  # 首轮无 rebuttal
        final_score = 0.0

        for round_num in range(1, self._config.max_rounds + 1):
            # 保守派 critique (首轮) 或 rebut (后续轮次)
            if round_num == 1:
                critique_text = await conservative.critique(current_proposal)
            else:
                critique_text = await conservative.rebut(current_proposal)

            if event_publisher:
                await event_publisher(EventAction.PROPOSE, agent="conservative_mp", text=critique_text, round_number=round_num, conflict_score=final_score)

            # 使用 ConflictScoreEngine 计算分歧度
            # 注意：当前轮次的 rebuttal 尚未生成，仅基于 proposal + critique 评分
            score_result = self._conflict_engine.compute(
                proposal=current_proposal,
                critique=critique_text,
            )
            score = score_result.score
            score_history.append(score)

            # 议长控场：分歧度超过控场阈值时介入
            intervention: str | None = None
            if score > self._config.conflict_threshold:
                if event_publisher:
                    await event_publisher(
                        EventAction.BRAWL, 
                        intensity=min(1.0, score / 100.0)
                    )
                    
                intervention = await speaker.intervene(
                    current_proposal,
                    critique_text,
                    score,
                )
                
                if event_publisher:
                    await event_publisher(
                        EventAction.ORDER, 
                        intensity=min(1.0, score / 100.0)
                    )
                    
                # 极端分歧下直接终止后续轮次，触发强行表决
                if score >= 90.0:
                    debate_round = DebateRound(
                        round_number=round_num,
                        proposal=current_proposal,
                        critique=critique_text,
                        rebuttal=last_rebuttal,
                        conflict_score=score,
                        speaker_intervention=intervention,
                    )
                    rounds.append(debate_round)
                    final_score = score
                    break

            debate_round = DebateRound(
                round_number=round_num,
                proposal=current_proposal,
                critique=critique_text,
                rebuttal=last_rebuttal,
                conflict_score=score,
                speaker_intervention=intervention,
            )

            rounds.append(debate_round)
            final_score = score

            # 终止判定：共识达成（分歧度低于阈值）
            if score < self._config.consensus_threshold and round_num >= self._config.min_rounds:
                break

            # 如果还有轮次，激进派反驳
            if round_num < self._config.max_rounds:
                last_rebuttal = await radical.rebut(critique_text)
                if event_publisher:
                    await event_publisher(EventAction.PROPOSE, agent="radical_mp", text=last_rebuttal, round_number=round_num, conflict_score=score)
                current_proposal = last_rebuttal

        # 计算趋势（至少 2 轮）
        trend: ConflictTrend | None = None
        if len(score_history) >= 2:  # noqa: PLR2004
            trend = self._conflict_engine.compute_trend(score_history)

        consensus = final_score < self._config.consensus_threshold
        return DebateResult(
            petition=petition,
            rounds=rounds,
            final_proposal=current_proposal,
            consensus_reached=consensus,
            final_conflict_score=final_score,
            conflict_trend=trend,
        )


# ---------------------------------------------------------------------------
# VotingMachine
# ---------------------------------------------------------------------------


class VotingMachine:
    """投票机制 — 简单多数制计票。"""

    async def tally(self, proposal: str, voters: list[Voter]) -> VoteResult:
        """收集投票并计票。

        Args:
            proposal: 待表决的提案文本。
            voters: 参与投票的 Agent 列表（需实现 Voter 协议）。

        Returns:
            投票结果。
        """
        records: list[VoteRecord] = []
        ayes = 0
        nays = 0

        for voter in voters:
            vote_value = await voter.vote(proposal)
            records.append(VoteRecord(voter_role=voter.role, vote=vote_value))
            if vote_value:
                ayes += 1
            else:
                nays += 1

        passed = ayes > nays
        return VoteResult(
            proposal=proposal,
            records=records,
            ayes=ayes,
            nays=nays,
            passed=passed,
        )
