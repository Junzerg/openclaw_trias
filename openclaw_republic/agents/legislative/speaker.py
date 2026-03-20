"""议长 Agent (Speaker) — 议会流程编排器。

职责：接收选民请愿 → 发起提案 → 控制辩论 Token 预算 →
判定终止 → 发起表决 → 产出《执行法案》。
"""

from __future__ import annotations

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


class Speaker(BaseAgent):
    """议长 — 议会辩论流程的总控。

    议长负责：接收选民请愿、分配辩论预算、控制辩论轮次、
    判定终止条件、发起表决、汇总产出结果。
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
