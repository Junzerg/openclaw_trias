"""单元测试 — 事件模型创建 & 序列化。"""

import json
from datetime import datetime

import pytest

from openclaw_republic.schemas.events import (
    BaseEvent,
    DebateEvent,
    EmotionType,
    EventAction,
    ExecutionEvent,
    JudgmentEvent,
    VoteEvent,
)


class TestEventAction:
    """测试 EventAction 枚举。"""

    def test_all_nine_actions_defined(self) -> None:
        """EventAction 枚举覆盖 PRD §4 定义的全部 9 种事件类型。"""
        expected_actions = {
            "propose",
            "brawl",
            "order",
            "vote_passed",
            "sign_act",
            "veto",
            "tool_call",
            "constitutional",
            "unconstitutional",
        }
        actual_actions = {a.value for a in EventAction}
        assert actual_actions == expected_actions

    def test_action_count(self) -> None:
        """EventAction 枚举恰好包含 9 种类型。"""
        assert len(EventAction) == 9

    def test_action_is_str_enum(self) -> None:
        """EventAction 是 str 类型枚举。"""
        assert isinstance(EventAction.PROPOSE.value, str)
        assert EventAction.PROPOSE == "propose"


class TestEmotionType:
    """测试 EmotionType 枚举。"""

    def test_all_emotions_defined(self) -> None:
        """EmotionType 覆盖全部 7 种情绪类型。"""
        expected = {"neutral", "passionate", "angry", "confident", "worried", "triumphant", "stern"}
        actual = {e.value for e in EmotionType}
        assert actual == expected


class TestBaseEvent:
    """测试 BaseEvent 基类。"""

    def test_create_base_event(self) -> None:
        """BaseEvent 可正确实例化。"""
        event = BaseEvent(
            source_agent="speaker",
            action=EventAction.ORDER,
        )
        assert event.source_agent == "speaker"
        assert event.action == EventAction.ORDER
        assert event.emotion == EmotionType.NEUTRAL
        assert event.intensity == 0.5
        assert event.target_agent is None
        assert event.payload == {}
        assert isinstance(event.timestamp, datetime)

    def test_json_serialization(self) -> None:
        """BaseEvent 可正确 JSON 序列化。"""
        event = BaseEvent(
            source_agent="speaker",
            action=EventAction.ORDER,
            emotion=EmotionType.STERN,
            intensity=0.9,
        )
        json_str = event.model_dump_json()
        data = json.loads(json_str)
        assert data["source_agent"] == "speaker"
        assert data["action"] == "order"
        assert data["emotion"] == "stern"
        assert data["intensity"] == 0.9

    def test_json_roundtrip(self) -> None:
        """BaseEvent 支持 JSON 往返序列化。"""
        original = BaseEvent(
            source_agent="president",
            action=EventAction.VETO,
            target_agent="speaker",
            task_id="task-001",
            payload={"reason": "budget exceeded"},
        )
        json_str = original.model_dump_json()
        restored = BaseEvent.model_validate_json(json_str)
        assert restored.source_agent == original.source_agent
        assert restored.action == original.action
        assert restored.target_agent == original.target_agent
        assert restored.task_id == original.task_id
        assert restored.payload == original.payload


class TestDebateEvent:
    """测试 DebateEvent。"""

    def test_create_debate_event(self) -> None:
        """DebateEvent 可正确实例化。"""
        event = DebateEvent(
            source_agent="radical_mp",
            action=EventAction.BRAWL,
            emotion=EmotionType.PASSIONATE,
            intensity=0.8,
            round_number=3,
            conflict_score=75.5,
            statement="我建议使用 Rust 重写核心模块！",
        )
        assert event.round_number == 3
        assert event.conflict_score == 75.5
        assert event.statement == "我建议使用 Rust 重写核心模块！"

    def test_debate_event_serializable(self) -> None:
        """DebateEvent 可 JSON 序列化。"""
        event = DebateEvent(
            source_agent="conservative_mp",
            action=EventAction.BRAWL,
            round_number=1,
            conflict_score=45.0,
            statement="这个方案存在严重的安全隐患。",
        )
        data = json.loads(event.model_dump_json())
        assert data["round_number"] == 1
        assert data["conflict_score"] == 45.0

    def test_invalid_round_number(self) -> None:
        """round_number < 1 抛出 ValidationError。"""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DebateEvent(
                source_agent="radical_mp",
                action=EventAction.BRAWL,
                round_number=0,
                conflict_score=50.0,
                statement="test",
            )


class TestVoteEvent:
    """测试 VoteEvent。"""

    def test_create_vote_event(self) -> None:
        """VoteEvent 可正确实例化。"""
        event = VoteEvent(
            source_agent="speaker",
            ayes=2,
            nays=1,
            result="passed",
        )
        assert event.action == EventAction.VOTE_PASSED
        assert event.ayes == 2
        assert event.nays == 1
        assert event.result == "passed"

    def test_vote_event_serializable(self) -> None:
        """VoteEvent 可 JSON 序列化。"""
        event = VoteEvent(
            source_agent="speaker",
            ayes=1,
            nays=2,
            result="rejected",
        )
        data = json.loads(event.model_dump_json())
        assert data["result"] == "rejected"
        assert data["action"] == "vote_passed"


class TestExecutionEvent:
    """测试 ExecutionEvent。"""

    def test_create_execution_event(self) -> None:
        """ExecutionEvent 可正确实例化。"""
        event = ExecutionEvent(
            source_agent="sec_engineering",
            action=EventAction.TOOL_CALL,
            tool_name="CodeExecution",
            step_index=0,
            status="running",
        )
        assert event.tool_name == "CodeExecution"
        assert event.step_index == 0
        assert event.status == "running"


class TestJudgmentEvent:
    """测试 JudgmentEvent。"""

    def test_create_constitutional_judgment(self) -> None:
        """合宪判决事件可正确实例化。"""
        event = JudgmentEvent(
            source_agent="chief_justice",
            action=EventAction.CONSTITUTIONAL,
            ruling="被审查的执行行为符合宪法全部相关条款。",
        )
        assert event.action == EventAction.CONSTITUTIONAL
        assert event.violation_type is None
        assert event.evidence == []

    def test_create_unconstitutional_judgment(self) -> None:
        """违宪判决事件可正确实例化。"""
        event = JudgmentEvent(
            source_agent="chief_justice",
            action=EventAction.UNCONSTITUTIONAL,
            violation_type="blacklist_command",
            ruling="检测到黑名单命令 'rm -rf'，判定违宪。",
            evidence=["执行日志第 42 行：rm -rf /tmp/data"],
        )
        assert event.action == EventAction.UNCONSTITUTIONAL
        assert event.violation_type == "blacklist_command"
        assert len(event.evidence) == 1

    def test_judgment_event_serializable(self) -> None:
        """JudgmentEvent 可 JSON 序列化。"""
        event = JudgmentEvent(
            source_agent="chief_justice",
            action=EventAction.UNCONSTITUTIONAL,
            ruling="违宪",
            evidence=["evidence_1", "evidence_2"],
        )
        data = json.loads(event.model_dump_json())
        assert len(data["evidence"]) == 2
