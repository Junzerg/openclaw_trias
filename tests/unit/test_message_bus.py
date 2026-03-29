"""消息总线单元测试。"""

from __future__ import annotations

import pytest

from openclaw_republic.bus.message_bus import TOPICS, MessageBus
from openclaw_republic.schemas.events import BaseEvent, EventAction


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bus() -> MessageBus:
    """创建一个新的 MessageBus 实例。"""
    return MessageBus()


def _make_event(
    source: str = "test_agent",
    action: EventAction = EventAction.PROPOSE,
    **kwargs: object,
) -> BaseEvent:
    """创建测试用事件。"""
    return BaseEvent(
        source_agent=source,
        action=action,
        **kwargs,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# 主题定义
# ---------------------------------------------------------------------------


class TestTopics:
    """测试主题常量。"""

    def test_topics_has_four(self) -> None:
        assert len(TOPICS) == 4  # noqa: PLR2004

    def test_topics_contains_expected(self) -> None:
        expected = {"legislation", "execution", "judiciary", "lifecycle"}
        assert TOPICS == expected


# ---------------------------------------------------------------------------
# 发布/订阅
# ---------------------------------------------------------------------------


class TestPublishSubscribe:
    """测试发布/订阅机制。"""

    @pytest.mark.asyncio
    async def test_subscriber_receives_event(self, bus: MessageBus) -> None:
        """订阅者正确收到发布的事件。"""
        received: list[BaseEvent] = []

        async def handler(event: BaseEvent) -> None:
            received.append(event)

        bus.subscribe("legislation", handler)
        event = _make_event()
        await bus.publish("legislation", event)

        assert len(received) == 1
        assert received[0] is event

    @pytest.mark.asyncio
    async def test_multiple_subscribers(self, bus: MessageBus) -> None:
        """多个订阅者都收到事件。"""
        received_a: list[BaseEvent] = []
        received_b: list[BaseEvent] = []

        async def handler_a(event: BaseEvent) -> None:
            received_a.append(event)

        async def handler_b(event: BaseEvent) -> None:
            received_b.append(event)

        bus.subscribe("execution", handler_a)
        bus.subscribe("execution", handler_b)

        event = _make_event()
        await bus.publish("execution", event)

        assert len(received_a) == 1
        assert len(received_b) == 1

    @pytest.mark.asyncio
    async def test_no_subscriber_event_still_logged(self, bus: MessageBus) -> None:
        """无订阅者时，事件仍然记录到 event_log。"""
        event = _make_event()
        await bus.publish("lifecycle", event)

        assert len(bus.event_log) == 1
        assert bus.event_log[0] is event

    @pytest.mark.asyncio
    async def test_cross_topic_isolation(self, bus: MessageBus) -> None:
        """不同主题的订阅者互不干扰。"""
        received: list[BaseEvent] = []

        async def handler(event: BaseEvent) -> None:
            received.append(event)

        bus.subscribe("legislation", handler)
        event = _make_event()
        await bus.publish("execution", event)  # 发到不同主题

        assert len(received) == 0

    @pytest.mark.asyncio
    async def test_subscriber_exception_does_not_block(
        self,
        bus: MessageBus,
    ) -> None:
        """某个订阅者抛异常不阻塞其他订阅者。"""
        received: list[BaseEvent] = []

        async def bad_handler(_event: BaseEvent) -> None:
            msg = "boom"
            raise RuntimeError(msg)

        async def good_handler(event: BaseEvent) -> None:
            received.append(event)

        bus.subscribe("judiciary", bad_handler)
        bus.subscribe("judiciary", good_handler)

        event = _make_event()
        await bus.publish("judiciary", event)

        assert len(received) == 1


# ---------------------------------------------------------------------------
# 无效主题
# ---------------------------------------------------------------------------


class TestInvalidTopic:
    """测试无效主题处理。"""

    @pytest.mark.asyncio
    async def test_publish_invalid_topic(self, bus: MessageBus) -> None:
        with pytest.raises(ValueError, match="无效主题"):
            await bus.publish("invalid_topic", _make_event())

    def test_subscribe_invalid_topic(self, bus: MessageBus) -> None:
        async def handler(_event: BaseEvent) -> None:
            pass  # pragma: no cover

        with pytest.raises(ValueError, match="无效主题"):
            bus.subscribe("invalid_topic", handler)


# ---------------------------------------------------------------------------
# 取消订阅
# ---------------------------------------------------------------------------


class TestUnsubscribe:
    """测试取消订阅。"""

    @pytest.mark.asyncio
    async def test_unsubscribe_stops_events(self, bus: MessageBus) -> None:
        received: list[BaseEvent] = []

        async def handler(event: BaseEvent) -> None:
            received.append(event)

        bus.subscribe("legislation", handler)
        await bus.publish("legislation", _make_event())
        assert len(received) == 1

        bus.unsubscribe("legislation", handler)
        await bus.publish("legislation", _make_event())
        assert len(received) == 1  # 不再收到

    def test_unsubscribe_nonexistent_handler(self, bus: MessageBus) -> None:
        async def handler(_event: BaseEvent) -> None:
            pass  # pragma: no cover

        with pytest.raises(ValueError, match="未注册"):
            bus.unsubscribe("legislation", handler)


# ---------------------------------------------------------------------------
# 生命周期
# ---------------------------------------------------------------------------


class TestLifecycle:
    """测试 start/stop 生命周期。"""

    @pytest.mark.asyncio
    async def test_start_stop(self, bus: MessageBus) -> None:
        assert not bus.is_running
        await bus.start()
        assert bus.is_running
        await bus.stop()
        assert not bus.is_running


# ---------------------------------------------------------------------------
# 事件日志
# ---------------------------------------------------------------------------


class TestEventLog:
    """测试事件日志记录。"""

    @pytest.mark.asyncio
    async def test_event_log_accumulates(self, bus: MessageBus) -> None:
        for i in range(3):
            await bus.publish("lifecycle", _make_event(source=f"agent_{i}"))

        assert len(bus.event_log) == 3  # noqa: PLR2004

    @pytest.mark.asyncio
    async def test_event_log_returns_copy(self, bus: MessageBus) -> None:
        await bus.publish("lifecycle", _make_event())
        log = bus.event_log
        log.clear()
        # 原始日志不受影响
        assert len(bus.event_log) == 1

    def test_subscriber_count(self, bus: MessageBus) -> None:
        assert bus.get_subscriber_count("legislation") == 0

        async def handler(_event: BaseEvent) -> None:
            pass  # pragma: no cover

        bus.subscribe("legislation", handler)
        assert bus.get_subscriber_count("legislation") == 1
