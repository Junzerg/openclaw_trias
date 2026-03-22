"""WebSocket ConnectionManager 单测。"""

import pytest
from unittest.mock import AsyncMock

from fastapi import WebSocket

from openclaw_republic.server.ws_manager import ConnectionManager


@pytest.mark.asyncio
async def test_ws_manager_connect_disconnect() -> None:
    manager = ConnectionManager()
    ws1 = AsyncMock(spec=WebSocket)
    ws2 = AsyncMock(spec=WebSocket)

    # 初始状态
    assert manager.get_connection_count("task1") == 0

    # 建立连接
    await manager.connect("task1", ws1)
    ws1.accept.assert_awaited_once()
    assert manager.get_connection_count("task1") == 1

    await manager.connect("task1", ws2)
    assert manager.get_connection_count("task1") == 2

    # 断开连接
    await manager.disconnect("task1", ws1)
    assert manager.get_connection_count("task1") == 1

    await manager.disconnect("task1", ws2)
    assert manager.get_connection_count("task1") == 0
    # manager 应该自动清理空集合
    assert "task1" not in manager._connections


@pytest.mark.asyncio
async def test_ws_manager_broadcast() -> None:
    manager = ConnectionManager()
    ws1 = AsyncMock(spec=WebSocket)
    ws2 = AsyncMock(spec=WebSocket)
    
    await manager.connect("task1", ws1)
    await manager.connect("task1", ws2)

    event_data = {"type": "test_event"}
    await manager.broadcast("task1", event_data)

    ws1.send_json.assert_awaited_once_with(event_data)
    ws2.send_json.assert_awaited_once_with(event_data)


@pytest.mark.asyncio
async def test_ws_manager_broadcast_failure_cleanup() -> None:
    manager = ConnectionManager()
    ws_ok = AsyncMock(spec=WebSocket)
    ws_fail = AsyncMock(spec=WebSocket)
    # mock 发送失败
    ws_fail.send_json.side_effect = Exception("Network Error")

    await manager.connect("task2", ws_ok)
    await manager.connect("task2", ws_fail)

    event_data = {"type": "test"}
    await manager.broadcast("task2", event_data)

    ws_ok.send_json.assert_awaited_once_with(event_data)
    ws_fail.send_json.assert_awaited_once_with(event_data)

    # 失败的连接应当被自动清理
    assert manager.get_connection_count("task2") == 1
    assert ws_ok in manager._connections["task2"]
    assert ws_fail not in manager._connections["task2"]
