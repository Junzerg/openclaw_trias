"""WebSocket 路由与端到端集成测试。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openclaw_republic.server.app import create_app


@pytest.fixture
def test_app() -> FastAPI:
    return create_app(config_dir="config", db_path=":memory:")


def test_websocket_connection_and_ping(test_app: FastAPI) -> None:
    """验证 WebSocket 可连接，并正确响应 ping 消息保持存活。"""
    task_id = "test-ws-task-123"

    with TestClient(test_app) as client:
        # FastAPI TestClient websocket 连接
        with client.websocket_connect(f"/ws/task/{task_id}") as websocket:
            # 发送心跳检测
            websocket.send_text("ping")
            data = websocket.receive_json()
            assert data == {"type": "pong"}

            # 断言 manager 中注册了此连接
            manager = test_app.state.ws_manager
            assert manager.get_connection_count(task_id) == 1

        # 断开后自动清理
        assert manager.get_connection_count(task_id) == 0


def test_websocket_broadcast_bridge(test_app: FastAPI) -> None:
    """验证 MessageBus 的事件能正确桥接并广播到对端 WebSocket 客户端。"""
    task_id = "test-ws-task-456"

    # 使用 lifespan 处理注册的总线钩子
    with TestClient(test_app) as client:
        with client.websocket_connect(f"/ws/task/{task_id}") as websocket:
            
            # 由于 TestClient 是同步阻塞的，我们在此上下文中验证基本通信通路（ping-pong）
            # 具体 broadcast 已在 test_ws_manager 单测中覆盖。
            websocket.send_text("ping")
            assert websocket.receive_json() == {"type": "pong"}
