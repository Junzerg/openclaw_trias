# mypy: ignore-errors
"""TaskStore 数据库持久化层单测。"""

import uuid
from pathlib import Path

import pytest
import pytest_asyncio

from openclaw_republic.server.task_store import TaskStatus, TaskStore

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def temp_db_path(tmp_path: Path):
    db_file = tmp_path / "test_tasks.db"
    return db_file


@pytest_asyncio.fixture
async def store(temp_db_path: Path):
    task_store = TaskStore(temp_db_path)
    await task_store.initialize()
    yield task_store
    await task_store.close()


async def test_task_store_create_and_get(store: TaskStore) -> None:
    """测试创建和查询任务。"""
    task_id = str(uuid.uuid4())
    petition_text = "测试请愿内容"

    # Create Task
    record = await store.create_task(task_id, petition_text)
    assert record.task_id == task_id
    assert record.petition == petition_text
    assert record and record.status == TaskStatus.PENDING

    # Get Task
    fetched = await store.get_task(task_id)
    assert fetched is not None
    assert fetched.task_id == task_id
    assert fetched.petition == petition_text
    assert fetched.status == TaskStatus.PENDING


async def test_task_store_update(store: TaskStore) -> None:
    """测试更新任务状态。"""
    task_id = str(uuid.uuid4())
    await store.create_task(task_id, "Test Update")

    # Update state
    await store.update_task(
        task_id, 
        status=TaskStatus.RUNNING, 
        bill_state="debating",
    )

    fetched = await store.get_task(task_id)
    assert fetched is not None
    assert fetched.status == TaskStatus.RUNNING
    assert fetched.bill_state == "debating"
    assert fetched.result is None

    # Update result
    await store.update_task(
        task_id, 
        status=TaskStatus.COMPLETED, 
        result="SuccessResult"
    )
    
    fetched = await store.get_task(task_id)
    assert fetched.status == TaskStatus.COMPLETED
    assert fetched.result == "SuccessResult"


async def test_task_store_list_pagination(store: TaskStore) -> None:
    """测试分页列表获取。"""
    # Create 5 tasks
    for i in range(5):
        await store.create_task(f"t_{i}", f"Petition {i}")

    # Query without pagination limit overrides default, limiting to 2
    records = await store.list_tasks(limit=2)
    assert len(records) == 2

    # Query remaining records with offset
    remaining = await store.list_tasks(offset=2, limit=5)
    assert len(remaining) == 3
