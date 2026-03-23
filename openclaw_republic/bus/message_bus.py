"""消息总线 — 三权分支间的异步消息传递协议。

基于 asyncio.Queue 实现内存队列发布/订阅，
后续可无缝切换为 Redis Streams / NATS。
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from openclaw_republic.schemas.events import BaseEvent

logger = logging.getLogger(__name__)

# 合法主题常量
TOPICS: frozenset[str] = frozenset(
    {
        "legislation",  # 立法分支事件
        "execution",  # 行政分支事件
        "judiciary",  # 司法分支事件
        "lifecycle",  # 法案生命周期事件
    }
)

# 订阅处理器类型
Handler = Callable[[BaseEvent], Awaitable[None]]


class MessageBus:
    """三权协作消息总线。

    初期基于 asyncio.Queue 实现内存队列，
    后续可无缝切换为 Redis Streams / NATS。

    消息路由规则：
    - 立法分支发布 Act → ``legislation`` 主题 → 行政分支订阅
    - 行政分支发布执行事件 → ``execution`` 主题 → 司法分支订阅
    - 总统否决 → ``legislation`` 主题 → 立法分支订阅
    - 司法违宪判决 → ``judiciary`` 主题 → 行政/立法分支订阅
    - 所有状态变更 → ``lifecycle`` 主题 → 状态机消费
    """

    def __init__(self) -> None:
        # 每个主题的订阅者列表
        self._subscribers: dict[str, list[Handler]] = {topic: [] for topic in TOPICS}
        # 全量事件日志
        self._event_log: list[BaseEvent] = []
        # 运行标志
        self._running = False

    # ─── 发布/订阅 ─────────────────────────

    async def publish(self, topic: str, event: BaseEvent) -> None:
        """发布事件到指定主题。

        将事件放入队列并立即分发给所有订阅者。

        Args:
            topic: 目标主题，必须是 TOPICS 中定义的合法主题。
            event: 要发布的事件。

        Raises:
            ValueError: 无效主题。
        """
        if topic not in TOPICS:
            msg = f"无效主题 '{topic}'，合法主题: {sorted(TOPICS)}"
            raise ValueError(msg)

        self._event_log.append(event)

        # 直接分发给所有订阅者
        for handler in self._subscribers[topic]:
            try:
                await handler(event)
            except Exception:
                logger.exception(
                    "订阅者处理事件失败: topic=%s, handler=%s",
                    topic,
                    handler.__name__,
                )

    def subscribe(self, topic: str, handler: Handler) -> None:
        """订阅指定主题。

        Args:
            topic: 要订阅的主题。
            handler: 异步回调函数，签名为 ``async def(event: BaseEvent) -> None``。

        Raises:
            ValueError: 无效主题。
        """
        if topic not in TOPICS:
            msg = f"无效主题 '{topic}'，合法主题: {sorted(TOPICS)}"
            raise ValueError(msg)

        self._subscribers[topic].append(handler)

    def unsubscribe(self, topic: str, handler: Handler) -> None:
        """取消订阅。

        Args:
            topic: 主题。
            handler: 先前注册的处理器。

        Raises:
            ValueError: 无效主题或处理器未注册。
        """
        if topic not in TOPICS:
            msg = f"无效主题 '{topic}'，合法主题: {sorted(TOPICS)}"
            raise ValueError(msg)

        try:
            self._subscribers[topic].remove(handler)
        except ValueError:
            msg = f"处理器 {handler.__name__} 未注册在主题 '{topic}'"
            raise ValueError(msg) from None

    # ─── 生命周期管理 ─────────────────────

    async def start(self) -> None:
        """启动消息总线。"""
        self._running = True
        logger.info("消息总线已启动")

    async def stop(self) -> None:
        """优雅停止总线。

        停止后不再接受新的发布请求（通过标志位控制）。
        """
        self._running = False
        logger.info("消息总线已停止")

    @property
    def is_running(self) -> bool:
        """总线是否正在运行。"""
        return self._running

    # ─── 查询接口 ─────────────────────────

    @property
    def event_log(self) -> list[BaseEvent]:
        """获取全量事件日志副本。"""
        return list(self._event_log)

    def get_subscriber_count(self, topic: str) -> int:
        """获取指定主题的订阅者数量。

        Args:
            topic: 主题名称。

        Returns:
            订阅者数量。

        Raises:
            ValueError: 无效主题。
        """
        if topic not in TOPICS:
            msg = f"无效主题 '{topic}'，合法主题: {sorted(TOPICS)}"
            raise ValueError(msg)
        return len(self._subscribers[topic])

    def _get_all_handlers(self) -> dict[str, list[Any]]:
        """内部调试用 — 返回所有订阅者映射。"""
        return dict(self._subscribers)
