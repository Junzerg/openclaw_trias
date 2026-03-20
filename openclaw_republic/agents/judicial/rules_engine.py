"""违宪规则引擎 — 从 constitution.yaml 加载规则集并执行校验。

规则集包含：黑名单命令、Token 预算上限、最大辩论轮次、产出偏离度阈值。
"""

from __future__ import annotations


class RulesEngine:
    """违宪规则引擎 — 基于宪法配置进行合规校验。"""

    def __init__(self) -> None:
        self.rules: list[dict] = []

    def load_rules(self, constitution_path: str) -> None:
        """从宪法配置文件加载规则集。

        Args:
            constitution_path: constitution.yaml 文件路径。
        """
        raise NotImplementedError

    def check(self, action: dict) -> bool:
        """检查行政动作是否违反宪法规则。

        Args:
            action: 待检查的行政动作。

        Returns:
            True 表示合宪，False 表示违宪。
        """
        raise NotImplementedError
