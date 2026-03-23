"""法案生命周期状态机。

管理法案从请愿到交付的全流程状态流转，
包含 Vetoed→Drafting 和 Unconstitutional→Drafting 回路。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class InvalidTransitionError(Exception):
    """非法状态转换时抛出。"""

    def __init__(self, from_state: BillState, to_state: BillState) -> None:
        self.from_state = from_state
        self.to_state = to_state
        super().__init__(f"非法状态转换: {from_state.value} → {to_state.value}")


# ---------------------------------------------------------------------------
# 状态枚举
# ---------------------------------------------------------------------------


class BillState(str, Enum):
    """法案生命周期状态 — 共 11 个状态。"""

    PETITION = "petition"
    DRAFTING = "drafting"
    DEBATING = "debating"
    VOTED = "voted"
    SIGNED = "signed"
    VETOED = "vetoed"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    CONSTITUTIONAL = "constitutional"
    UNCONSTITUTIONAL = "unconstitutional"
    DELIVERED = "delivered"


# ---------------------------------------------------------------------------
# 合法转换定义
# ---------------------------------------------------------------------------

VALID_TRANSITIONS: dict[BillState, set[BillState]] = {
    BillState.PETITION: {BillState.DRAFTING},
    BillState.DRAFTING: {BillState.DEBATING},
    BillState.DEBATING: {BillState.VOTED},
    BillState.VOTED: {BillState.SIGNED, BillState.VETOED},
    BillState.SIGNED: {BillState.EXECUTING},
    BillState.VETOED: {BillState.DRAFTING},  # 回到起草
    BillState.EXECUTING: {BillState.REVIEWING},
    BillState.REVIEWING: {BillState.CONSTITUTIONAL, BillState.UNCONSTITUTIONAL},
    BillState.CONSTITUTIONAL: {BillState.DELIVERED},
    BillState.UNCONSTITUTIONAL: {BillState.DRAFTING},  # 回到起草
    BillState.DELIVERED: set(),  # 终态
}


# ---------------------------------------------------------------------------
# 状态转换记录
# ---------------------------------------------------------------------------


class StateTransition(BaseModel):
    """单次状态转换的历史记录。"""

    from_state: BillState = Field(description="转换前状态")
    to_state: BillState = Field(description="转换后状态")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc),
        description="转换时间",
    )


# ---------------------------------------------------------------------------
# BillLifecycle
# ---------------------------------------------------------------------------


class BillLifecycle:
    """法案生命周期管理器。

    跟踪单个法案从 PETITION 到 DELIVERED（或回路）的全部
    状态转换，记录每次转换的历史。
    """

    def __init__(self, bill_id: str) -> None:
        """初始化法案生命周期。

        Args:
            bill_id: 法案唯一标识。
        """
        self.bill_id = bill_id
        self.current_state = BillState.PETITION
        self._history: list[StateTransition] = []

    def transition(self, to_state: BillState) -> StateTransition:
        """执行状态转换。

        Args:
            to_state: 目标状态。

        Returns:
            本次状态转换记录。

        Raises:
            InvalidTransitionError: 非法状态转换。
        """
        valid_targets = VALID_TRANSITIONS.get(self.current_state, set())
        if to_state not in valid_targets:
            raise InvalidTransitionError(self.current_state, to_state)

        record = StateTransition(
            from_state=self.current_state,
            to_state=to_state,
        )
        self._history.append(record)
        self.current_state = to_state
        return record

    @property
    def history(self) -> list[StateTransition]:
        """获取状态转换历史副本。"""
        return list(self._history)

    @property
    def is_terminal(self) -> bool:
        """当前状态是否为终态（已交付）。"""
        return self.current_state == BillState.DELIVERED
