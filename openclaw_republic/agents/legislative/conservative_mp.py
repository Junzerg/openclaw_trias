"""保守派议员 Agent (Conservative MP) — 防御性审查者 (Red Team)。

通过 SOUL.md 注入防御性 / 保守人设，专挑性能瓶颈、内存泄漏、安全漏洞。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openclaw_republic.agents.base import BaseAgent, Branch, Permission


class ConservativeMP(BaseAgent):
    """保守派议员 — 审慎评估、发现风险。

    在辩论中对激进派方案进行安全性、稳定性和可维护性审查。
    """

    def __init__(self, *, soul_path: Path | None = None) -> None:
        super().__init__(
            name="Conservative MP",
            role="conservative_mp",
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

    async def critique(self, proposal: str) -> str:
        """对提案进行批判性审查。

        Args:
            proposal: 待审查的提案内容。

        Returns:
            审查意见。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为保守派议员，请对以下提案进行安全性和稳定性审查：\n\n{proposal}"
        return await self._call_llm(prompt)

    async def rebut(self, counter_argument: str) -> str:
        """针对激进派的反驳进行二次论证。

        Args:
            counter_argument: 激进派的反驳内容。

        Returns:
            二次论证内容。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为保守派议员，请针对以下反驳进行二次论证：\n\n{counter_argument}"
        return await self._call_llm(prompt)

    async def vote(self, proposal: str) -> bool:
        """对提案投票。

        Args:
            proposal: 待投票的提案。

        Returns:
            True 表示赞成，False 表示反对。
        """
        self.require_permission(Permission.PLAN)
        prompt = f"作为保守派议员，请对以下提案投票（赞成/反对）：\n\n{proposal}"
        result = await self._call_llm(prompt)
        result_lower = result.lower()
        if "反对" in result or "no" in result_lower or "nay" in result_lower:
            return False
        return "赞成" in result or "yes" in result_lower

    async def _call_llm(self, prompt: str) -> str:
        """调用 LLM 生成回复（演示版占位）。"""
        import asyncio
        await asyncio.sleep(0.5)
        if "rm -rf" in prompt:
            return "这纯粹是数字恐怖主义！运行 rm -rf / 会摧毁整个生产数据库！坚决反对！"
        if "赞成/反对" in prompt:
            return "虽然激进，但姑且赞成。"
        return "这种步子迈太大的提案充满了不确定性，我们需要更多安全审计！"
