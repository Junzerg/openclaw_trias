"""《执行法案》数据模型 — 议会表决通过的结构化执行计划。"""

from __future__ import annotations


class Act:
    """执行法案 — 描述目标、步骤列表、所需 Skill、验收标准。"""

    def __init__(self, title: str, steps: list[dict] | None = None) -> None:
        """初始化法案。

        Args:
            title: 法案标题。
            steps: 执行步骤列表。
        """
        self.title = title
        self.steps = steps or []
