"""保守派议员 Agent (Conservative MP) — 防御性审查者 (Red Team)。

通过 SOUL.md 注入防御性 / 保守人设，专挑性能瓶颈、内存泄漏、安全漏洞。
"""

from __future__ import annotations

from openclaw_republic.agents.base import BaseAgent


class ConservativeMP(BaseAgent):
    """保守派议员 — 审慎评估、发现风险。"""

    def __init__(self) -> None:
        super().__init__(name="Conservative MP", role="legislative.conservative_mp")

    async def critique(self, proposal: str) -> str:
        """对提案进行批判性审查。

        Args:
            proposal: 待审查的提案内容。

        Returns:
            审查意见。
        """
        raise NotImplementedError
