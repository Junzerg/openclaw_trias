"""TaskQueue 的单元测试。"""

import asyncio

import pytest

from openclaw_republic.server.task_queue import TaskQueue


@pytest.mark.asyncio
async def test_task_queue_concurrency() -> None:
    queue = TaskQueue(max_concurrent=1)
    
    execution_order: list[int] = []
    
    async def dummy_task(task_id: int, delay: float) -> None:
        execution_order.append(-task_id)  # Record start
        await asyncio.sleep(delay)
        execution_order.append(task_id)   # Record finish
        
    # 提交三个任务
    await queue.submit("task1", dummy_task(1, 0.1))
    
    # 第一个任务是同步提交执行开始的
    # 交出控制权使得 task 跑起来
    await asyncio.sleep(0.01)
    assert queue.running_count == 1
    assert queue.pending_count == 0
    
    await queue.submit("task2", dummy_task(2, 0.05))
    await queue.submit("task3", dummy_task(3, 0.05))
    
    await asyncio.sleep(0.01)
    
    # 此时 task1 还在跑，task2 和 task3 应该在 pending
    assert queue.running_count == 1
    assert queue.pending_count == 2
    
    # 等待所有执行完毕
    await asyncio.sleep(0.3)
    
    assert queue.running_count == 0
    assert queue.pending_count == 0
    
    # 验证执行顺序：因为并发是1，应该严格按顺序交替执行
    assert execution_order == [-1, 1, -2, 2, -3, 3]


@pytest.mark.asyncio
async def test_task_queue_cancel() -> None:
    queue = TaskQueue(max_concurrent=1)
    
    ran = False
    
    async def infinite_task() -> None:
        nonlocal ran
        ran = True
        await asyncio.sleep(100.0)
        
    await queue.submit("task1", infinite_task())
    
    # 让协程启动
    await asyncio.sleep(0.01)
    assert queue.running_count == 1
    assert ran
    
    # 取消任务
    canceled = await queue.cancel("task1")
    assert canceled is True
    
    await asyncio.sleep(0.01)
    
    # 第二次取消，因为任务已经从队列中移除，应该返回 False
    canceled_again = await queue.cancel("task1")
    assert canceled_again is False
    
    await asyncio.sleep(0.01)
    # 取消后应该清理状态
    assert queue.running_count == 0
