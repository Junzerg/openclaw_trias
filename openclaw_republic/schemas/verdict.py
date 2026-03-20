"""司法判决模型 — 违宪审查结果的结构化表示。"""

from __future__ import annotations


class Verdict:
    """司法判决 — 记录审查结论与处置措施。"""

    def __init__(self, constitutional: bool, reason: str = "") -> None:
        """初始化判决。

        Args:
            constitutional: True 表示合宪，False 表示违宪。
            reason: 判决理由。
        """
        self.constitutional = constitutional
        self.reason = reason
