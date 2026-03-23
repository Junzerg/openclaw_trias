"""事件日志单元测试。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from openclaw_republic.bus.event_log import EventLogger
from openclaw_republic.schemas.events import BaseEvent, EventAction


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def event_logger() -> EventLogger:
    return EventLogger()


def _make_event(
    source: str = "test_agent",
    action: EventAction = EventAction.PROPOSE,
    **kwargs: object,
) -> BaseEvent:
    return BaseEvent(
        source_agent=source,
        action=action,
        **kwargs,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# 基本记录
# ---------------------------------------------------------------------------


class TestEventLoggerBasic:
    """测试基本事件记录。"""

    def test_log_and_count(self, event_logger: EventLogger) -> None:
        assert event_logger.count == 0
        event_logger.log(_make_event())
        assert event_logger.count == 1

    def test_log_multiple(self, event_logger: EventLogger) -> None:
        for i in range(5):
            event_logger.log(_make_event(source=f"agent_{i}"))
        assert event_logger.count == 5  # noqa: PLR2004

    def test_clear(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event())
        event_logger.clear()
        assert event_logger.count == 0


# ---------------------------------------------------------------------------
# 按条件查询
# ---------------------------------------------------------------------------


class TestEventLoggerQuery:
    """测试按条件查询事件。"""

    def test_filter_by_source_agent(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(source="speaker"))
        event_logger.log(_make_event(source="president"))
        event_logger.log(_make_event(source="speaker"))

        results = event_logger.get_events(source_agent="speaker")
        assert len(results) == 2  # noqa: PLR2004
        assert all(e.source_agent == "speaker" for e in results)

    def test_filter_by_action(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(action=EventAction.PROPOSE))
        event_logger.log(_make_event(action=EventAction.VETO))
        event_logger.log(_make_event(action=EventAction.PROPOSE))

        results = event_logger.get_events(action=EventAction.PROPOSE)
        assert len(results) == 2  # noqa: PLR2004

    def test_filter_by_since(self, event_logger: EventLogger) -> None:
        old_event = _make_event()
        # 手动修改时间戳
        old_event.timestamp = datetime.now(tz=timezone.utc) - timedelta(hours=2)
        event_logger.log(old_event)

        new_event = _make_event()
        event_logger.log(new_event)

        since = datetime.now(tz=timezone.utc) - timedelta(hours=1)
        results = event_logger.get_events(since=since)
        assert len(results) == 1
        assert results[0] is new_event

    def test_combined_filters(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(source="speaker", action=EventAction.PROPOSE))
        event_logger.log(_make_event(source="speaker", action=EventAction.VETO))
        event_logger.log(_make_event(source="president", action=EventAction.PROPOSE))

        results = event_logger.get_events(
            source_agent="speaker",
            action=EventAction.PROPOSE,
        )
        assert len(results) == 1

    def test_no_matches(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(source="speaker"))
        results = event_logger.get_events(source_agent="president")
        assert results == []

    def test_no_filters_returns_all(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event())
        event_logger.log(_make_event())
        results = event_logger.get_events()
        assert len(results) == 2  # noqa: PLR2004


# ---------------------------------------------------------------------------
# WebSocket 导出
# ---------------------------------------------------------------------------


class TestEventLoggerExport:
    """测试 WebSocket 导出。"""

    def test_export_format(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(source="speaker", action=EventAction.PROPOSE))
        exported = event_logger.export_for_websocket()

        assert len(exported) == 1
        assert isinstance(exported[0], dict)
        assert exported[0]["source_agent"] == "speaker"
        assert exported[0]["action"] == "propose"

    def test_export_empty(self, event_logger: EventLogger) -> None:
        exported = event_logger.export_for_websocket()
        assert exported == []

    def test_export_multiple(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event(source="speaker"))
        event_logger.log(_make_event(source="president"))
        exported = event_logger.export_for_websocket()
        assert len(exported) == 2  # noqa: PLR2004

    def test_export_contains_all_fields(self, event_logger: EventLogger) -> None:
        event_logger.log(_make_event())
        exported = event_logger.export_for_websocket()
        entry = exported[0]

        # 所有 BaseEvent 字段都应存在
        required_fields = {
            "timestamp", "source_agent", "target_agent",
            "action", "emotion", "intensity", "payload", "task_id",
        }
        assert required_fields.issubset(set(entry.keys()))
