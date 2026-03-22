# mypy: ignore-errors
"""单元测试 — Agent 消息模型。"""

from __future__ import annotations

from datetime import datetime

from openclaw_republic.schemas.messages import AgentMessage, MessageType


class TestMessageTypeEnum:
    """MessageType 枚举测试。"""

    def test_has_ten_members(self) -> None:
        """MessageType 包含 10 种消息类型。"""
        assert len(MessageType) == 10

    def test_member_values(self) -> None:
        """各消息类型值正确。"""
        expected = {
            "petition",
            "proposal",
            "critique",
            "rebuttal",
            "vote",
            "act",
            "veto_notice",
            "execution_result",
            "judgment",
            "system",
        }
        assert {m.value for m in MessageType} == expected

    def test_is_str_enum(self) -> None:
        """MessageType 是 str 枚举。"""
        assert MessageType.PETITION == "petition"


class TestAgentMessage:
    """AgentMessage 模型测试。"""

    def test_minimal_creation(self) -> None:
        """最小参数创建消息。"""
        msg = AgentMessage(
            sender="speaker",
            content="测试消息",
            message_type=MessageType.SYSTEM,
        )
        assert msg.sender == "speaker"
        assert msg.receiver is None
        assert msg.content == "测试消息"
        assert msg.message_type == MessageType.SYSTEM

    def test_full_creation(self) -> None:
        """完整参数创建消息。"""
        msg = AgentMessage(
            sender="radical_mp",
            receiver="speaker",
            content="提案内容",
            message_type=MessageType.PROPOSAL,
            metadata={"priority": "high"},
        )
        assert msg.sender == "radical_mp"
        assert msg.receiver == "speaker"
        assert msg.metadata == {"priority": "high"}

    def test_default_metadata_is_empty_dict(self) -> None:
        """默认 metadata 为空 dict。"""
        msg = AgentMessage(
            sender="test",
            content="test",
            message_type=MessageType.SYSTEM,
        )
        assert msg.metadata == {}

    def test_default_metadata_not_shared(self) -> None:
        """不同实例的 metadata 不共享引用。"""
        msg1 = AgentMessage(sender="test", content="1", message_type=MessageType.SYSTEM)
        msg2 = AgentMessage(sender="test", content="2", message_type=MessageType.SYSTEM)
        msg1.metadata["key"] = "value"
        assert "key" not in msg2.metadata

    def test_timestamp_auto_generated(self) -> None:
        """timestamp 自动生成。"""
        msg = AgentMessage(
            sender="test",
            content="test",
            message_type=MessageType.SYSTEM,
        )
        assert isinstance(msg.timestamp, datetime)

    def test_serialization_roundtrip(self) -> None:
        """JSON 序列化/反序列化正确。"""
        msg = AgentMessage(
            sender="speaker",
            receiver="radical_mp",
            content="分配发言",
            message_type=MessageType.SYSTEM,
            metadata={"round": 1},
        )
        json_str = msg.model_dump_json()
        restored = AgentMessage.model_validate_json(json_str)
        assert restored.sender == msg.sender
        assert restored.receiver == msg.receiver
        assert restored.content == msg.content
        assert restored.message_type == msg.message_type
        assert restored.metadata == msg.metadata

    def test_model_dump(self) -> None:
        """model_dump() 返回正确字典。"""
        msg = AgentMessage(
            sender="test",
            content="hello",
            message_type=MessageType.PETITION,
        )
        data = msg.model_dump()
        assert data["sender"] == "test"
        assert data["content"] == "hello"
        assert data["message_type"] == "petition"
        assert "timestamp" in data

    def test_message_id_auto_generated(self) -> None:
        """每条消息自动生成唯一 message_id。"""
        msg = AgentMessage(
            sender="test",
            content="test",
            message_type=MessageType.SYSTEM,
        )
        assert isinstance(msg.message_id, str)
        assert len(msg.message_id) > 0

    def test_message_id_unique(self) -> None:
        """不同消息的 message_id 互不相同。"""
        msg1 = AgentMessage(sender="test", content="1", message_type=MessageType.SYSTEM)
        msg2 = AgentMessage(sender="test", content="2", message_type=MessageType.SYSTEM)
        assert msg1.message_id != msg2.message_id
