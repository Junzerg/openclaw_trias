"""法案生命周期状态机。

状态流转：Petition → Drafting → Debating → Voted →
Signed/Vetoed → Executing → Reviewing →
Constitutional/Unconstitutional → Delivered
"""

from __future__ import annotations


class StateMachine:
    """法案生命周期状态机 — 管理法案从请愿到交付的全流程。"""

    STATES = [
        "petition",
        "drafting",
        "debating",
        "voted",
        "signed",
        "vetoed",
        "executing",
        "reviewing",
        "constitutional",
        "unconstitutional",
        "delivered",
    ]

    def __init__(self) -> None:
        self.current_state: str = "petition"

    def transition(self, to_state: str) -> None:
        """执行状态转换。

        Args:
            to_state: 目标状态。

        Raises:
            ValueError: 非法状态转换。
        """
        raise NotImplementedError
