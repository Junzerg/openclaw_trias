"""WebSocket 连接管理 — 维护按任务分组的客户端长连接。"""

from __future__ import annotations

import logging
import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket 连接管理器。

    管理按 task_id 分组的 WebSocket 连接，
    支持多客户端同时订阅同一任务。
    """

    def __init__(self) -> None:
        # task_id -> set of active WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, task_id: str, ws: WebSocket) -> None:
        """接受并注册一个 WebSocket 连接。

        Args:
            task_id: 关联的任务 ID。
            ws: WebSocket 实例。
        """
        await ws.accept()
        if task_id not in self._connections:
            self._connections[task_id] = set()
        self._connections[task_id].add(ws)
        logger.debug("WebSocket connected to task_id=%s. Total: %d", task_id, len(self._connections[task_id]))

    async def disconnect(self, task_id: str, ws: WebSocket) -> None:
        """移除断开的连接。

        Args:
            task_id: 关联的任务 ID。
            ws: WebSocket 实例。
        """
        if task_id in self._connections:
            self._connections[task_id].discard(ws)
            if not self._connections[task_id]:
                del self._connections[task_id]
            logger.debug("WebSocket disconnected from task_id=%s.", task_id)

    async def broadcast(self, task_id: str, event: dict[str, Any]) -> None:
        """向指定 task_id 的所有连接广播事件。

        使用 asyncio.gather 并发推送，避免个别慢连接阻塞整个广播过程。

        Args:
            task_id: 目标任务 ID。
            event: 序列化后的 JSON 事件字典。
        """
        if task_id not in self._connections:
            return

        async def _send(ws: WebSocket) -> tuple[WebSocket, bool]:
            try:
                await ws.send_json(event)
                return ws, True
            except Exception as e:
                logger.warning("Failed to broadcast to ws: %s", e)
                return ws, False

        connections = list(self._connections[task_id])
        if not connections:
            return
            
        results = await asyncio.gather(*[_send(ws) for ws in connections])
        
        for ws, success in results:
            if not success:
                await self.disconnect(task_id, ws)

    def get_connection_count(self, task_id: str) -> int:
        """获取指定任务的活跃连接数。

        Args:
            task_id: 任务 ID。

        Returns:
            连接数。
        """
        return len(self._connections.get(task_id, set()))
