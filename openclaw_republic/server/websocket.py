"""WebSocket 事件推送 — 实时 Agent 事件流。"""

from __future__ import annotations


async def websocket_endpoint(websocket: object) -> None:
    """WebSocket 端点 — 推送实时 Agent 事件。

    Args:
        websocket: WebSocket 连接实例。
    """
    raise NotImplementedError
