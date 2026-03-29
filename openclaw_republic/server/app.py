"""FastAPI 应用 — API 服务入口。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from openclaw_republic.bus.message_bus import TOPICS
from openclaw_republic.government import CyberGovernment
from openclaw_republic.schemas.events import BaseEvent
from openclaw_republic.server.routes import register_routes
from openclaw_republic.server.task_queue import TaskQueue
from openclaw_republic.server.task_store import TaskStore
from openclaw_republic.server.websocket import websocket_endpoint
from openclaw_republic.server.ws_manager import ConnectionManager


class AppState:
    """全局应用状态 — 持有 CyberGovernment、TaskStore 和 ConnectionManager。"""

    government: CyberGovernment
    task_store: TaskStore
    task_queue: TaskQueue
    ws_manager: ConnectionManager


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI 生命周期管理 — 启动/关闭 Government 和 DB。"""
    state: AppState = app.state  # type: ignore[assignment]
    import asyncio
    import json
    import logging
    from openclaw_republic.schemas.events import EventAction

    logger = logging.getLogger(__name__)

    async def _ws_bridge(event: BaseEvent) -> None:
        if event.task_id is None:
            return
        ws_payload = event.model_dump(mode="json")
        asyncio.create_task(state.ws_manager.broadcast(event.task_id, ws_payload))

    async def _db_bridge(event: BaseEvent) -> None:
        if event.task_id is None:
            return
        try:
            event_dump = event.model_dump(mode="json")
            payload_str = json.dumps(event_dump, ensure_ascii=False)
            await state.task_store.store_event(
                task_id=event.task_id,
                source_agent=event.source_agent,
                action=event.action.value,
                emotion=event.emotion.value,
                intensity=event.intensity,
                payload=payload_str,
            )

            # The act and verdict might be in event_dump["payload"] since they were passed to BaseEvent.payload
            event_raw_payload = event_dump.get("payload", {})
            if event.action == EventAction.VOTE_PASSED and "act" in event_raw_payload:
                act_json = json.dumps(event_raw_payload["act"], ensure_ascii=False)
                await state.task_store.store_act(event.task_id, act_json)

            if (
                event.action in (EventAction.CONSTITUTIONAL, EventAction.UNCONSTITUTIONAL)
                and "verdict" in event_raw_payload
            ):
                verdict_data = event_raw_payload["verdict"]
                constitutional = verdict_data.get("constitutional", False)
                ruling = verdict_data.get("ruling", "")
                evidence = json.dumps(verdict_data.get("evidence", []), ensure_ascii=False)
                await state.task_store.store_verdict(
                    event.task_id, constitutional, ruling, evidence
                )

        except Exception as e:
            logger.error("DB Bridge failed to store event: %s", e, exc_info=True)

    for topic in TOPICS:
        state.government.bus.subscribe(topic, _ws_bridge)
        state.government.bus.subscribe(topic, _db_bridge)

    await state.government.inaugurate()
    await state.task_store.initialize()
    yield
    await state.government.shutdown()
    await state.task_store.close()


def create_app(
    config_dir: Path | str = "config",
    db_path: Path | str = "data/tasks.db",
) -> FastAPI:
    """创建并配置 FastAPI 应用实例。

    Args:
        config_dir: 配置文件目录。
        db_path: SQLite 数据库路径。

    Returns:
        FastAPI 应用实例。
    """
    app = FastAPI(
        title="OpenClaw Republic API",
        description="三权分立 AI 协作政府 — 通信桥接层",
        version="0.2.0",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 初始化全局状态
    state = AppState()
    state.government = CyberGovernment(config_dir)
    state.task_store = TaskStore(db_path)
    state.task_queue = TaskQueue(max_concurrent=1)
    state.ws_manager = ConnectionManager()

    # 将 state 注入 app
    app.state.government = state.government
    app.state.task_store = state.task_store
    app.state.task_queue = state.task_queue
    app.state.ws_manager = state.ws_manager

    # 注册路由
    register_routes(app)

    @app.websocket("/ws/task/{task_id}")
    async def ws_task(websocket: WebSocket, task_id: str) -> None:
        ws_state: AppState = app.state  # type: ignore[assignment]
        await websocket_endpoint(websocket, task_id, ws_state.ws_manager, ws_state)

    return app
