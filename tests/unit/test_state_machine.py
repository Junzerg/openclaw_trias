# mypy: ignore-errors
"""法案生命周期状态机单元测试。"""

from __future__ import annotations

import pytest

from openclaw_republic.bus.state_machine import (
    VALID_TRANSITIONS,
    BillLifecycle,
    BillState,
    InvalidTransitionError,
    StateTransition,
)


# ---------------------------------------------------------------------------
# BillState 枚举
# ---------------------------------------------------------------------------


class TestBillState:
    """测试 BillState 枚举。"""

    def test_has_eleven_states(self) -> None:
        assert len(BillState) == 11  # noqa: PLR2004

    def test_values(self) -> None:
        expected = {
            "petition", "drafting", "debating", "voted",
            "signed", "vetoed", "executing", "reviewing",
            "constitutional", "unconstitutional", "delivered",
        }
        assert {s.value for s in BillState} == expected

    def test_is_string_mixin(self) -> None:
        assert BillState.PETITION.value == "petition"


# ---------------------------------------------------------------------------
# VALID_TRANSITIONS
# ---------------------------------------------------------------------------


class TestValidTransitions:
    """测试合法转换表。"""

    def test_all_states_have_entry(self) -> None:
        """每个状态都必须在转换表中有条目。"""
        for state in BillState:
            assert state in VALID_TRANSITIONS

    def test_delivered_is_terminal(self) -> None:
        """DELIVERED 是终态，无后续转换。"""
        assert VALID_TRANSITIONS[BillState.DELIVERED] == set()

    def test_vetoed_goes_to_drafting(self) -> None:
        assert BillState.DRAFTING in VALID_TRANSITIONS[BillState.VETOED]

    def test_unconstitutional_goes_to_drafting(self) -> None:
        assert BillState.DRAFTING in VALID_TRANSITIONS[BillState.UNCONSTITUTIONAL]

    def test_voted_can_sign_or_veto(self) -> None:
        targets = VALID_TRANSITIONS[BillState.VOTED]
        assert BillState.SIGNED in targets
        assert BillState.VETOED in targets


# ---------------------------------------------------------------------------
# BillLifecycle — 基本操作
# ---------------------------------------------------------------------------


class TestBillLifecycleBasic:
    """测试 BillLifecycle 基本操作。"""

    def test_initial_state(self) -> None:
        lifecycle = BillLifecycle("bill-001")
        assert lifecycle.current_state == BillState.PETITION
        assert lifecycle.bill_id == "bill-001"
        assert lifecycle.history == []

    def test_valid_transition(self) -> None:
        lifecycle = BillLifecycle("bill-001")
        record = lifecycle.transition(BillState.DRAFTING)
        assert lifecycle.current_state == BillState.DRAFTING
        assert isinstance(record, StateTransition)
        assert record.from_state == BillState.PETITION
        assert record.to_state == BillState.DRAFTING

    def test_invalid_transition_raises(self) -> None:
        lifecycle = BillLifecycle("bill-001")
        with pytest.raises(InvalidTransitionError) as exc_info:
            lifecycle.transition(BillState.VOTED)  # PETITION → VOTED 非法

        assert exc_info.value.from_state == BillState.PETITION
        assert exc_info.value.to_state == BillState.VOTED
        assert "petition" in str(exc_info.value)
        assert "voted" in str(exc_info.value)

    def test_is_terminal_false(self) -> None:
        lifecycle = BillLifecycle("bill-001")
        assert not lifecycle.is_terminal

    def test_history_returns_copy(self) -> None:
        lifecycle = BillLifecycle("bill-001")
        lifecycle.transition(BillState.DRAFTING)
        history = lifecycle.history
        history.clear()
        assert len(lifecycle.history) == 1


# ---------------------------------------------------------------------------
# 完整流程
# ---------------------------------------------------------------------------


class TestBillLifecycleHappyPath:
    """测试 happy path 完整流程。"""

    def test_full_happy_path(self) -> None:
        """Petition → Drafting → Debating → Voted → Signed → Executing
        → Reviewing → Constitutional → Delivered。
        """
        lifecycle = BillLifecycle("bill-happy")
        transitions = [
            BillState.DRAFTING,
            BillState.DEBATING,
            BillState.VOTED,
            BillState.SIGNED,
            BillState.EXECUTING,
            BillState.REVIEWING,
            BillState.CONSTITUTIONAL,
            BillState.DELIVERED,
        ]

        for target in transitions:
            lifecycle.transition(target)

        assert lifecycle.current_state == BillState.DELIVERED
        assert lifecycle.is_terminal
        assert len(lifecycle.history) == len(transitions)


class TestBillLifecycleVetoLoop:
    """测试 Veto 回路。"""

    def test_veto_loop(self) -> None:
        """Petition → Drafting → Debating → Voted → Vetoed → Drafting → ...。"""
        lifecycle = BillLifecycle("bill-veto")

        # 第一轮
        lifecycle.transition(BillState.DRAFTING)
        lifecycle.transition(BillState.DEBATING)
        lifecycle.transition(BillState.VOTED)
        lifecycle.transition(BillState.VETOED)
        assert lifecycle.current_state == BillState.VETOED

        # 回到 Drafting
        lifecycle.transition(BillState.DRAFTING)
        assert lifecycle.current_state == BillState.DRAFTING

        # 第二轮继续
        lifecycle.transition(BillState.DEBATING)
        lifecycle.transition(BillState.VOTED)
        lifecycle.transition(BillState.SIGNED)
        assert lifecycle.current_state == BillState.SIGNED


class TestBillLifecycleUnconstitutionalLoop:
    """测试违宪回路。"""

    def test_unconstitutional_loop(self) -> None:
        """完整执行 → 违宪 → 回到 Drafting。"""
        lifecycle = BillLifecycle("bill-unconst")

        lifecycle.transition(BillState.DRAFTING)
        lifecycle.transition(BillState.DEBATING)
        lifecycle.transition(BillState.VOTED)
        lifecycle.transition(BillState.SIGNED)
        lifecycle.transition(BillState.EXECUTING)
        lifecycle.transition(BillState.REVIEWING)
        lifecycle.transition(BillState.UNCONSTITUTIONAL)
        assert lifecycle.current_state == BillState.UNCONSTITUTIONAL

        # 回到 Drafting
        lifecycle.transition(BillState.DRAFTING)
        assert lifecycle.current_state == BillState.DRAFTING


# ---------------------------------------------------------------------------
# InvalidTransitionError
# ---------------------------------------------------------------------------


class TestInvalidTransitionError:
    """测试异常类。"""

    def test_exception_attributes(self) -> None:
        err = InvalidTransitionError(BillState.PETITION, BillState.DELIVERED)
        assert err.from_state == BillState.PETITION
        assert err.to_state == BillState.DELIVERED

    def test_exception_message(self) -> None:
        err = InvalidTransitionError(BillState.PETITION, BillState.DELIVERED)
        assert "petition" in str(err)
        assert "delivered" in str(err)

    def test_is_exception(self) -> None:
        assert issubclass(InvalidTransitionError, Exception)


# ---------------------------------------------------------------------------
# StateTransition
# ---------------------------------------------------------------------------


class TestStateTransition:
    """测试 StateTransition 模型。"""

    def test_creation(self) -> None:
        transition = StateTransition(
            from_state=BillState.PETITION,
            to_state=BillState.DRAFTING,
        )
        assert transition.from_state == BillState.PETITION
        assert transition.to_state == BillState.DRAFTING
        assert transition.timestamp is not None
