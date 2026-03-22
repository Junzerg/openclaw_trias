"""Agent 间通信的标准消息格式。"""

from __future__ import annotations

import uuid

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class MessageType(str, Enum):
    """消息类型枚举。"""

    PETITION = "petition"  # 选民请愿
    PROPOSAL = "proposal"  # 提案
    CRITIQUE = "critique"  # 批评
    REBUTTAL = "rebuttal"  # 反驳
    VOTE = "vote"  # 投票
    ACT = "act"  # 法案
    VETO_NOTICE = "veto_notice"  # 否决通知
    EXECUTION_RESULT = "execution_result"  # 执行结果
    JUDGMENT = "judgment"  # 判决
    SYSTEM = "system"  # 系统消息


class AgentMessage(BaseModel):
    """Agent 间通信的标准消息格式。

    Attributes:
        sender: 发送方 Agent 角色名。
        receiver: 接收方 Agent 角色名（None 表示广播）。
        content: 消息正文。
        message_type: 消息类型。
        message_id: 消息唯一标识（UUID 自动生成）。
        metadata: 自由扩展元数据。
        timestamp: 消息创建时间戳。
    """

    sender: str
    receiver: str | None = None
    content: str
    message_type: MessageType
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.now)
