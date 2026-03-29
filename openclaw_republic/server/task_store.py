"""SQLite 任务持久化存储。"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

import aiosqlite
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """任务状态。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskRecord(BaseModel):
    """任务记录。"""
    task_id: str
    petition: str
    status: TaskStatus
    result: str | None = None
    bill_state: str = "petition"
    created_at: datetime
    updated_at: datetime


class TaskStore:
    """SQLite 任务持久化存储。

    开发阶段使用 SQLite (aiosqlite)，后续可扩展 Redis。
    """

    def __init__(self, db_path: Path | str) -> None:
        """初始化 TaskStore。

        Args:
            db_path: SQLite 数据库文件路径。
        """
        self.db_path = Path(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """初始化数据库连接和表结构。"""
        # Ensure parent directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        self._conn = await aiosqlite.connect(self.db_path)
        # Enable foreign keys and set row factory
        await self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.row_factory = aiosqlite.Row

        # Create tables if not exist
        query_tasks = """
        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            petition TEXT NOT NULL,
            status TEXT NOT NULL,
            result TEXT,
            bill_state TEXT NOT NULL DEFAULT 'petition',
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """
        query_events = """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            source_agent TEXT NOT NULL,
            action TEXT NOT NULL,
            emotion TEXT DEFAULT 'neutral',
            intensity REAL DEFAULT 0.5,
            payload TEXT DEFAULT '{}',
            FOREIGN KEY (task_id) REFERENCES tasks(task_id)
        )
        """
        query_acts = """
        CREATE TABLE IF NOT EXISTS acts (
            task_id TEXT PRIMARY KEY,
            act_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(task_id)
        )
        """
        query_verdicts = """
        CREATE TABLE IF NOT EXISTS verdicts (
            task_id TEXT PRIMARY KEY,
            constitutional BOOLEAN NOT NULL,
            ruling TEXT NOT NULL,
            evidence TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(task_id)
        )
        """
        await self._conn.execute(query_tasks)
        await self._conn.execute(query_events)
        await self._conn.execute(query_acts)
        await self._conn.execute(query_verdicts)
        await self._conn.commit()
        logger.info("TaskStore initialized at %s", self.db_path)

    def _ensure_conn(self) -> aiosqlite.Connection:
        if not self._conn:
            raise RuntimeError("TaskStore not initialized. Call initialize() first.")
        return self._conn

    async def create_task(self, task_id: str, petition: str) -> TaskRecord:
        """创建新任务记录。

        Args:
            task_id: 任务 ID。
            petition: 请愿内容。

        Returns:
            创建的 TaskRecord。
        """
        conn = self._ensure_conn()
        now = datetime.now(timezone.utc)
        record = TaskRecord(
            task_id=task_id,
            petition=petition,
            status=TaskStatus.PENDING,
            bill_state="petition",
            created_at=now,
            updated_at=now,
        )

        query = """
        INSERT INTO tasks (task_id, petition, status, result, bill_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        await conn.execute(
            query,
            (
                record.task_id,
                record.petition,
                record.status.value,
                record.result,
                record.bill_state,
                record.created_at.isoformat(),
                record.updated_at.isoformat(),
            ),
        )
        await conn.commit()
        return record

    async def get_task(self, task_id: str) -> TaskRecord | None:
        """查询单个任务。

        Args:
            task_id: 任务 ID。

        Returns:
            TaskRecord 对象，不存在则返回 None。
        """
        conn = self._ensure_conn()
        query = "SELECT * FROM tasks WHERE task_id = ?"
        async with conn.execute(query, (task_id,)) as cursor:
            row = await cursor.fetchone()

        if not row:
            return None

        return TaskRecord(
            task_id=row["task_id"],
            petition=row["petition"],
            status=TaskStatus(row["status"]),
            result=row["result"],
            bill_state=row["bill_state"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def update_task(self, task_id: str, **kwargs: Any) -> None:
        """更新任务状态/结果。

        Args:
            task_id: 任务 ID。
            **kwargs: 需要更新的字段（如 status, result, bill_state）。
        """
        if not kwargs:
            return

        conn = self._ensure_conn()
        now = datetime.now(timezone.utc).isoformat()
        
        updates = []
        values = []
        for key, val in kwargs.items():
            updates.append(f"{key} = ?")
            if isinstance(val, Enum):
                values.append(val.value)
            else:
                values.append(val)
                
        updates.append("updated_at = ?")
        values.append(now)
        values.append(task_id)

        set_clause = ", ".join(updates)
        query = f"UPDATE tasks SET {set_clause} WHERE task_id = ?"
        
        await conn.execute(query, values)
        await conn.commit()

    async def count_tasks(self) -> int:
        """获取任务总数。"""
        conn = self._ensure_conn()
        query = "SELECT COUNT(*) FROM tasks"
        async with conn.execute(query) as cursor:
            row = await cursor.fetchone()
            if row:
                return int(row[0])
            return 0

    async def list_tasks(self, offset: int = 0, limit: int = 20) -> list[TaskRecord]:
        """分页查询任务列表。

        Args:
            offset: 偏移量。
            limit: 最大返回数量。

        Returns:
            任务列表（按更新时间倒序）。
        """
        conn = self._ensure_conn()
        query = "SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        
        records = []
        async with conn.execute(query, (limit, offset)) as cursor:
            async for row in cursor:
                records.append(
                    TaskRecord(
                        task_id=row["task_id"],
                        petition=row["petition"],
                        status=TaskStatus(row["status"]),
                        result=row["result"],
                        bill_state=row["bill_state"],
                        created_at=datetime.fromisoformat(row["created_at"]),
                        updated_at=datetime.fromisoformat(row["updated_at"]),
                    )
                )
        return records

    async def store_event(self, task_id: str, source_agent: str, action: str, 
                          emotion: str = "neutral", intensity: float = 0.5, payload: str = "{}") -> None:
        """保存日志事件。"""
        conn = self._ensure_conn()
        now = datetime.now(timezone.utc).isoformat()
        query = """
        INSERT INTO events (task_id, timestamp, source_agent, action, emotion, intensity, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        await conn.execute(query, (task_id, now, source_agent, action, emotion, intensity, payload))
        await conn.commit()

    async def get_task_events(self, task_id: str) -> list[aiosqlite.Row]:
        """获取任务的所有事件。"""
        conn = self._ensure_conn()
        query = "SELECT * FROM events WHERE task_id = ? ORDER BY id ASC"
        async with conn.execute(query, (task_id,)) as cursor:
            return list(await cursor.fetchall())

    async def store_act(self, task_id: str, act_json: str) -> None:
        """保存法案。"""
        conn = self._ensure_conn()
        now = datetime.now(timezone.utc).isoformat()
        query = """
        INSERT INTO acts (task_id, act_json, created_at)
        VALUES (?, ?, ?)
        """
        await conn.execute(query, (task_id, act_json, now))
        await conn.commit()

    async def get_task_act(self, task_id: str) -> aiosqlite.Row | None:
        """获取法案。"""
        conn = self._ensure_conn()
        query = "SELECT * FROM acts WHERE task_id = ?"
        async with conn.execute(query, (task_id,)) as cursor:
            return await cursor.fetchone()

    async def store_verdict(self, task_id: str, constitutional: bool, ruling: str, evidence: str = "[]") -> None:
        """保存判决。"""
        conn = self._ensure_conn()
        now = datetime.now(timezone.utc).isoformat()
        query = """
        INSERT INTO verdicts (task_id, constitutional, ruling, evidence, created_at)
        VALUES (?, ?, ?, ?, ?)
        """
        await conn.execute(query, (task_id, constitutional, ruling, evidence, now))
        await conn.commit()

    async def get_task_verdict(self, task_id: str) -> aiosqlite.Row | None:
        """获取判决。"""
        conn = self._ensure_conn()
        query = "SELECT * FROM verdicts WHERE task_id = ?"
        async with conn.execute(query, (task_id,)) as cursor:
            return await cursor.fetchone()

    async def close(self) -> None:
        """关闭数据库连接。"""
        if self._conn:
            await self._conn.close()
            self._conn = None
            logger.info("TaskStore connection closed.")
