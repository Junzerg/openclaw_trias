"""WebSocket 事件模型 — 实时推送的结构化事件定义。"""

from __future__ import annotations


class Event:
    """结构化事件基类。

    所有 Agent 的 action 统一记录为结构化事件，
    包含 emotion、intensity 等字段。
    """

    def __init__(self, event_type: str, agent: str, payload: dict | None = None) -> None:
        """初始化事件。

        Args:
            event_type: 事件类型标识。
            agent: 产生事件的 Agent 名称。
            payload: 事件附加数据。
        """
        self.event_type = event_type
        self.agent = agent
        self.payload = payload or {}
