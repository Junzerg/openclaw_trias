"""国务卿 Agent (Secretary of State) — 外部信息检索与 API 交互。

挂载 WebBrowser、Search 技能，
负责外部信息检索与 API 交互。
"""

from __future__ import annotations

from openclaw_republic.agents.base import BaseAgent, Branch, Permission


class SecretaryOfState(BaseAgent):
    """国务卿 — 负责外部信息获取。"""

    _available_tools = ["WebBrowser", "Search"]

    def __init__(self) -> None:
        super().__init__(
            name="Sec. of State",
            role="sec_state",
            branch=Branch.EXECUTIVE,
            permissions={Permission.EXECUTE},
        )

    async def research(self, query: str) -> str:
        """执行外部信息检索任务。

        Args:
            query: 检索查询内容。

        Returns:
            检索结果摘要。
        """
        raise NotImplementedError
