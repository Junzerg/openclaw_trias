"""结构化事件日志记录器。

所有 Agent action 统一记录为结构化事件，
含 emotion, intensity 等字段，
直接对标 PRD §4 的 WebSocket 事件格式。
"""

from __future__ import annotations

from datetime import datetime

from openclaw_republic.schemas.events import BaseEvent, EventAction


class EventLogger:
    """结构化事件日志记录器。

    记录所有 Agent 动作事件，支持按条件查询和
    WebSocket 推送格式导出。
    """

    def __init__(self) -> None:
        self._events: list[BaseEvent] = []

    def log(self, event: BaseEvent) -> None:
        """记录一条事件。

        Args:
            event: 要记录的事件。
        """
        self._events.append(event)

    def get_events(
        self,
        source_agent: str | None = None,
        action: EventAction | None = None,
        since: datetime | None = None,
    ) -> list[BaseEvent]:
        """按条件查询事件。

        所有参数均为可选过滤条件，多个条件为 AND 逻辑。

        Args:
            source_agent: 按发出事件的 Agent 角色名过滤。
            action: 按事件动作类型过滤。
            since: 只返回此时间之后的事件。

        Returns:
            符合条件的事件列表。
        """
        results: list[BaseEvent] = []
        for event in self._events:
            if source_agent is not None and event.source_agent != source_agent:
                continue
            if action is not None and event.action != action:
                continue
            if since is not None:
                event_ts = event.timestamp.replace(tzinfo=None)
                since_ts = since.replace(tzinfo=None)
                if event_ts < since_ts:
                    continue
            results.append(event)
        return results

    def export_for_websocket(self) -> list[dict[str, object]]:
        """导出为 WebSocket 推送格式。

        Returns:
            事件字典列表，每个字典包含事件的所有字段。
        """
        return [event.model_dump(mode="json") for event in self._events]

    @property
    def count(self) -> int:
        """已记录的事件总数。"""
        return len(self._events)

    def clear(self) -> None:
        """清空所有事件记录。"""
        self._events.clear()
