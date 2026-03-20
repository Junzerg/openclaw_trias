"""议长 Agent (Speaker) — 议会流程编排器。

职责：接收选民请愿 → 发起提案 → 控制辩论 Token 预算 →
判定终止 → 发起表决 → 产出《执行法案》。
"""

from __future__ import annotations

from openclaw_republic.agents.base import BaseAgent


class Speaker(BaseAgent):
    """议长 — 议会辩论流程的总控。"""

    def __init__(self) -> None:
        super().__init__(name="Speaker", role="legislative.speaker")

    async def open_session(self, petition: str) -> None:
        """开启议会会议，接收选民请愿。

        Args:
            petition: 选民提交的请愿内容。
        """
        raise NotImplementedError
