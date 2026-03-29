"""测试 9 种基础事件的构造和序列化。"""

from openclaw_republic.schemas.events import (
    BaseEvent,
    DebateEvent,
    EventAction,
    ExecutionEvent,
    JudgmentEvent,
    VetoEvent,
    VoteEvent,
    EmotionType,
)

def test_propose_event() -> None:
    event = DebateEvent(
        source_agent="radical_mp",
        action=EventAction.PROPOSE,
        emotion=EmotionType.PASSIONATE,
        statement="我们必须通过这项法案！",
        task_id="test-task",
        round_number=1,
        conflict_score=10.5,
    )
    assert event.action == EventAction.PROPOSE
    assert event.emotion == EmotionType.PASSIONATE
    data = event.model_dump(mode="json")
    assert data["action"] == "propose"
    assert data["statement"] == "我们必须通过这项法案！"
    assert "timestamp" in data

def test_brawl_event() -> None:
    event = BaseEvent(
        source_agent="speaker",
        action=EventAction.BRAWL,
        intensity=0.85,
        task_id="test-task",
    )
    assert event.action == EventAction.BRAWL
    assert event.intensity == 0.85

def test_order_event() -> None:
    event = BaseEvent(
        source_agent="speaker",
        action=EventAction.ORDER,
        intensity=0.9,
    )
    assert event.action == EventAction.ORDER

def test_vote_passed_event() -> None:
    event = VoteEvent(
        source_agent="speaker",
        ayes=2,
        nays=0,
        result="passed",
    )
    assert event.action == EventAction.VOTE_PASSED
    assert event.ayes == 2

def test_sign_act_event() -> None:
    event = BaseEvent(
        source_agent="president",
        action=EventAction.SIGN_ACT,
    )
    assert event.action == EventAction.SIGN_ACT

def test_veto_event() -> None:
    event = VetoEvent(
        source_agent="president",
        reason="内容太荒谬。",
    )
    assert event.action == EventAction.VETO
    assert event.reason == "内容太荒谬。"

def test_tool_call_event() -> None:
    event = ExecutionEvent(
        source_agent="sec_engineering",
        action=EventAction.TOOL_CALL,
        tool_name="CodeExecution",
        step_index=0,
        status="running",
    )
    assert event.action == EventAction.TOOL_CALL
    assert event.tool_name == "CodeExecution"

def test_judgment_event_constitutional() -> None:
    event = JudgmentEvent(
        source_agent="chief_justice",
        action=EventAction.CONSTITUTIONAL,
        ruling="完全合宪",
        reason="符合自由原则",
    )
    assert event.action == EventAction.CONSTITUTIONAL

def test_judgment_event_unconstitutional() -> None:
    event = JudgmentEvent(
        source_agent="chief_justice",
        action=EventAction.UNCONSTITUTIONAL,
        ruling="违宪",
        reason="侵犯公民权利",
        traceback="执行过程中触发了安全拦截",
        evidence=["发现非法访问"],
    )
    assert event.action == EventAction.UNCONSTITUTIONAL
    assert event.traceback == "执行过程中触发了安全拦截"
