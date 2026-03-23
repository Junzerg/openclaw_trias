"""异步任务队列。"""

from __future__ import annotations

import asyncio
import logging
from typing import Coroutine, Any

logger = logging.getLogger(__name__)


class TaskQueue:
    """异步任务调度器。

    控制同时运行的 Pipeline 数量，防止多任务竞争 LLM Token 预算和系统资源。
    """

    def __init__(self, max_concurrent: int = 1) -> None:
        """初始化 TaskQueue。
        
        Args:
            max_concurrent: 最大并发执行的任务数。
        """
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._running: dict[str, asyncio.Task[Any]] = {}
        self._pending_count = 0

    async def submit(self, task_id: str, coro: Coroutine[Any, Any, Any]) -> None:
        """提交任务到队列。

        如果并发数未满，立即执行；否则排队等待。
        """
        async def _wrapper() -> None:
            self._pending_count += 1
            try:
                logger.info("Task %s is waiting for execution slot (pending: %d)", task_id, self._pending_count)
                async with self._semaphore:
                    self._pending_count -= 1
                    logger.info("Task %s started execution", task_id)
                    try:
                        await coro
                    except asyncio.CancelledError:
                        logger.warning("Task %s was cancelled", task_id)
                    except Exception as e:
                        logger.error("Task %s failed: %s", task_id, e, exc_info=True)
                    finally:
                        logger.info("Task %s finished execution", task_id)
            finally:
                if task_id in self._running:
                    del self._running[task_id]

        task = asyncio.create_task(_wrapper())
        self._running[task_id] = task

    async def cancel(self, task_id: str) -> bool:
        """取消尚未完成的任务。"""
        if task_id in self._running:
            task = self._running[task_id]
            task.cancel()
            return True
        return False

    @property
    def running_count(self) -> int:
        """当前正在执行或已分配并发槽的任务数。"""
        # 注意: len(_running) 包含等待 semaphore 的任务，
        # running_count 精确值应当是通过 _running 减去 _pending_count，或者是已被 locked 的 semaphore
        return len(self._running) - self._pending_count

    @property
    def pending_count(self) -> int:
        """等待执行的任务数。"""
        return self._pending_count
