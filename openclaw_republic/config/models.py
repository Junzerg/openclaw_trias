"""配置 Pydantic 模型 — 类型安全的配置数据结构。"""

from __future__ import annotations


class RepublicSettings:
    """全局配置模型 — 使用 pydantic-settings 加载和校验。"""

    def __init__(self) -> None:
        self.max_debate_rounds: int = 5
        self.token_budget: int = 100000
        self.conflict_score_threshold: float = 80.0
