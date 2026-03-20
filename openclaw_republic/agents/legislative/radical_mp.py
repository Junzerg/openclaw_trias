"""激进派议员 Agent (Radical MP) — 前沿技术倡导者。

通过 SOUL.md 注入极客 / 激进人设，偏好前沿技术栈、代码极简，提议大胆。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openclaw_republic.agents.base import BaseAgent, Branch, Permission


class RadicalMP(BaseAgent):
    """激进派议员 — 推动大胆革新方案。

    在辩论中主动提出前沿技术方案，并对保守派批评进行反驳。
    """

    def __init__(self, *, soul_path: Path | None = None) -> None:
        super().__init__(
            name="Radical MP",
            role="radical_mp",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=soul_path,
        )

    async def act(self, message: Any) -> Any:
        """核心处理循环。

        Args:
            message: 输入消息。

        Returns:
            处理结果。
        """
        self.require_permission(Permission.PLAN)
        return None

    async def propose(self, petition: str) -> str:
        """针对选民请愿生成提案。

        Args:
            petition: 选民请愿内容。

        Returns:
            提案内容。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为激进派议员，请针对以下选民请愿提出前沿技术方案：\n\n{petition}"
        return await self._call_llm(prompt)

    async def rebut(self, critique: str) -> str:
        """反驳保守派的批评。

        Args:
            critique: 保守派的批评内容。

        Returns:
            反驳内容。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为激进派议员，请反驳以下保守派的批评：\n\n{critique}"
        return await self._call_llm(prompt)

    async def vote(self, proposal: str) -> bool:
        """对提案投票。

        Args:
            proposal: 待投票的提案。

        Returns:
            True 表示赞成，False 表示反对。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为激进派议员，请对以下提案投票（赞成/反对）：\n\n{proposal}"
        result = await self._call_llm(prompt)
        # 简单判定：包含"赞成"则赞成，否则反对
        return "赞成" in result or "yes" in result.lower()

    async def _call_llm(self, prompt: str) -> str:
        """调用 LLM 生成回复（占位实现，后续替换为真实 LLM 调用）。

        Args:
            prompt: 发送给 LLM 的完整提示词。

        Returns:
            LLM 的回复文本。
        """
        _ = prompt
        return ""
