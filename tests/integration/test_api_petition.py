# mypy: ignore-errors
"""Petition API 集成测试。"""

from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from openclaw_republic.server.app import create_app
from openclaw_republic.server.task_store import TaskStatus

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def app_instance(tmp_path: Path):
    """创建并提供测试用 FastAPI 实例。"""
    db_path = tmp_path / "test_tasks.db"
    app = create_app(config_dir="config", db_path=db_path)
    await app.state.task_store.initialize()
    yield app
    await app.state.task_store.close()


@pytest_asyncio.fixture
async def client(app_instance):
    """异步测试客户端，带有自动 lifespan 触发。"""
    transport = ASGITransport(app=app_instance)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@patch("openclaw_republic.government.CyberGovernment.receive_petition")
async def test_submit_petition_and_status(mock_receive_petition, client: AsyncClient) -> None:
    """测试 POST /petition 提交和 GET /task/{id}/status 查询。"""
    mock_receive_petition.return_value = "法案 123 已交付。\n执行状态: success\n判决: YES\n总 Token 消耗: 100"
    
    # 1. 提交请愿
    response = await client.post(
        "/petition",
        json={"prompt": "请写一个冒泡排序法案"}
    )
    assert response.status_code == 202
    data = response.json()
    assert "task_id" in data
    assert data["status"] == "pending"
    
    task_id = data["task_id"]
    
    # 等待异步任务执行 (_run_petition 中有 asyncio.create_task)
    import asyncio
    await asyncio.sleep(0.1) # 让后台任务跑一跑
    
    # 2. 查询状态
    status_response = await client.get(f"/task/{task_id}/status")
    assert status_response.status_code == 200
    status_data = status_response.json()
    
    assert status_data["task_id"] == task_id
    assert status_data["petition"] == "请写一个冒泡排序法案"
    
    # 断言管线执行
    mock_receive_petition.assert_called_once_with("请写一个冒泡排序法案")
    
    # 如果后台任务跑完了，应该是 completed 状态；
    # 无论跑没跑完，status 字段都应存在
    assert status_data["status"] in [TaskStatus.PENDING.value, TaskStatus.RUNNING.value, TaskStatus.COMPLETED.value]
    
    
async def test_get_task_status_not_found(client: AsyncClient) -> None:
    """测试查询不存在的任务。"""
    response = await client.get("/task/invalid-uuid-404/status")
    assert response.status_code == 404
    assert response.json() == {"detail": "Task not found"}
