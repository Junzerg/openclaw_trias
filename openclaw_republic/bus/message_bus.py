"""消息总线 — 三分支间的异步消息传递协议。

初期使用内存队列，后续可扩展为 Redis / NATS。
"""

from __future__ import annotations

from typing import Any


class MessageBus:
    """消息总线 — 管理三权分支之间的消息路由。"""

    def __init__(self) -> None:
        self._subscribers: dict[str, list] = {}

    def subscribe(self, topic: str, handler: Any) -> None:
        """订阅指定主题的消息。

        Args:
            topic: 消息主题。
            handler: 消息处理回调。
        """
        raise NotImplementedError

    async def publish(self, topic: str, message: Any) -> None:
        """向指定主题发布消息。

        Args:
            topic: 消息主题。
            message: 消息内容。
        """
        raise NotImplementedError
