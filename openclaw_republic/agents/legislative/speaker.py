"""议长 Agent (Speaker) — 议会流程编排器。

职责：接收选民请愿 → 发起提案 → 控制辩论 Token 预算 →
判定终止 → 发起表决 → 产出《执行法案》。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from openclaw_republic.agents.base import BaseAgent, Branch, Permission

if TYPE_CHECKING:
    from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
    from openclaw_republic.agents.legislative.debate import (
        DebateResult,
        VoteResult,
        Voter,
    )
    from openclaw_republic.agents.legislative.radical_mp import RadicalMP
    from openclaw_republic.config.models import DebateConfig
    from openclaw_republic.schemas.act import Act


class Speaker(BaseAgent):
    """议长 — 议会辩论流程的总控。

    议长负责：接收选民请愿、分配辩论预算、控制辩论轮次、
    判定终止条件、发起表决、控场介入、汇总产出结果。
    """

    def __init__(self, *, soul_path: Path | None = None) -> None:
        super().__init__(
            name="Speaker",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=soul_path,
        )
        self._current_petition: str | None = None

    async def act(self, message: Any) -> Any:
        """核心处理循环 — 议长接收消息后进行流程编排。

        Args:
            message: 输入消息。

        Returns:
            处理结果。
        """
        self.require_permission(Permission.PLAN)
        # 当前阶段仅做权限校验，完整的消息分发逻辑在 Task 1-F 实现
        return None

    async def receive_petition(self, petition: str) -> None:
        """接收选民请愿，启动立法流程。

        Args:
            petition: 选民提交的请愿内容。
        """
        self.require_permission(Permission.PLAN)
        self._current_petition = petition

    async def moderate_debate(
        self,
        radical: RadicalMP,
        conservative: ConservativeMP,
        config: DebateConfig,
        event_publisher: Any | None = None,
    ) -> DebateResult:
        """控场：管理辩论轮次、判定终止条件。

        辩论流程：
        1. 激进派针对请愿提出提案
        2. 保守派对提案进行批评
        3. 激进派反驳批评
        4. 计算 Conflict Score
        5. 循环直到共识达成或轮次耗尽

        Args:
            radical: 激进派议员。
            conservative: 保守派议员。
            config: 辩论规则配置。

        Returns:
            辩论结果。

        Raises:
            ValueError: 尚未接收请愿。
        """
        from openclaw_republic.agents.legislative.debate import (
            DebateEngine,
        )

        self.require_permission(Permission.PLAN)

        if self._current_petition is None:
            msg = "尚未接收选民请愿，无法启动辩论"
            raise ValueError(msg)

        engine = DebateEngine(config)
        return await engine.run_debate(
            speaker=self,
            radical=radical,
            conservative=conservative,
            petition=self._current_petition,
            event_publisher=event_publisher,
        )

    async def call_vote(
        self,
        proposal: str,
        voters: list[Voter],
    ) -> VoteResult:
        """发起表决。

        Args:
            proposal: 待表决的提案文本。
            voters: 参与投票的 Agent 列表。

        Returns:
            投票结果。
        """
        from openclaw_republic.agents.legislative.debate import (
            VotingMachine,
        )

        self.require_permission(Permission.PLAN)
        machine = VotingMachine()
        return await machine.tally(proposal, voters)

    async def intervene(
        self,
        proposal: str,
        critique: str,
        conflict_score: float,
    ) -> str:
        """议长控场介入 — 在分歧度过高时发出冷静声明。

        Args:
            proposal: 当前提案文本。
            critique: 当前批评文本。
            conflict_score: 当前分歧度评分。

        Returns:
            控场声明文本。
        """
        self.require_permission(Permission.PLAN)
        prompt = (
            f"作为议长，当前辩论分歧度达到 {conflict_score:.1f}，"
            f"已超过控场阈值。请发出冷静声明，引导双方理性讨论。\n\n"
            f"提案摘要：{proposal[:200]}\n"
            f"批评摘要：{critique[:200]}"
        )
        return await self._call_llm(prompt)

    async def generate_act(
        self,
        petition: str,
        debate_result: DebateResult,
        vote_result: VoteResult,
    ) -> Act:
        """生成《执行法案》— 辩论结束 + 表决通过后生成结构化法案。

        将辩论共识转化为结构化的 Act，包含执行步骤、辩论记录
        和表决记录。

        当前阶段使用占位实现：从 final_proposal 生成单步 Act。
        后续将由 LLM 将自然语言共识提炼为 ActStep 列表。

        Args:
            petition: 原始选民请愿内容。
            debate_result: 辩论结果。
            vote_result: 表决结果。

        Returns:
            完整的执行法案。

        Raises:
            ValueError: 表决未通过，无法生成法案。
        """
        from openclaw_republic.schemas.act import (
            Act,
            ActStep,
            ActVoteRecord,
            DebateRecord,
        )

        self.require_permission(Permission.PLAN)

        if not vote_result.passed:
            msg = "表决未通过，无法生成执行法案"
            raise ValueError(msg)

        # 从辩论结果提取共识点（占位：使用 LLM 提炼）
        prompt = f"将以下辩论共识提炼为执行步骤：\n\n{debate_result.final_proposal}"
        _ = await self._call_llm(prompt)

        # 占位实现：从 final_proposal 生成单步 Act
        step = ActStep(
            index=0,
            description=debate_result.final_proposal,
            required_skill="CodeExecution",
            tool_parameters={},
            estimated_tokens=10000,
            acceptance_criteria="按照提案内容完成执行",
        )

        # 构建辩论记录
        debate_record = DebateRecord(
            total_rounds=len(debate_result.rounds),
            final_conflict_score=debate_result.final_conflict_score,
            consensus_points=[debate_result.final_proposal],
            remaining_concerns=[],
        )

        # 构建表决记录
        voter_positions: dict[str, str] = {}
        for record in vote_result.records:
            voter_positions[record.voter_role] = "aye" if record.vote else "nay"

        act_vote_record = ActVoteRecord(
            ayes=vote_result.ayes,
            nays=vote_result.nays,
            result="passed" if vote_result.passed else "rejected",
            voter_positions=voter_positions,
        )

        return Act(
            act_id=str(uuid.uuid4()),
            title=f"法案：{petition[:50]}",
            summary=debate_result.final_proposal[:200],
            petition_origin=petition,
            steps=[step],
            total_estimated_tokens=step.estimated_tokens,
            debate_record=debate_record,
            vote_record=act_vote_record,
        )

    async def _call_llm(self, prompt: str) -> str:
        """调用 LLM 生成回复（占位实现，后续替换为真实 LLM 调用）。

        Args:
            prompt: 发送给 LLM 的完整提示词。

        Returns:
            LLM 的回复文本。
        """
        _ = prompt
        return ""
