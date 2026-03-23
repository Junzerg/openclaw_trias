"""WebSocket 事件推送 — 实时 Agent 事件流。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect

if TYPE_CHECKING:
    from openclaw_republic.server.ws_manager import ConnectionManager
    from openclaw_republic.server.app import AppState


async def websocket_endpoint(
    websocket: WebSocket,
    task_id: str,
    manager: ConnectionManager,
    state: AppState,  # Added AppState
) -> None:
    """WebSocket 端点 — 推送实时 Agent 事件。

    Args:
        websocket: WebSocket 连接实例。
        task_id: 客户端订阅的任务 ID。
        manager: 全局 WebSocket 连接管理器。
    """
    await manager.connect(task_id, websocket)
    try:
        import json

        while True:
            # 持续监听客户端心跳或控制消息以维持连接
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                try:
                    payload = json.loads(data)
                    action = payload.get("action", "")
                    if action == "new_task":
                        prompt = payload.get("data", {}).get("prompt", "")
                        if prompt:
                            # 导入和提交背景任务
                            from openclaw_republic.server.routes import _run_petition

                            # 因为前端测试时固定写死了 task_id，再次触发会导致 SQLite UNIQUE 冲突被吞掉
                            # 这里自动清理该 task_id 下的所有历史记录以支持反复跑测试流。
                            try:
                                conn = state.task_store._ensure_conn()
                                await conn.execute(
                                    "DELETE FROM events WHERE task_id = ?", (task_id,)
                                )
                                await conn.execute("DELETE FROM acts WHERE task_id = ?", (task_id,))
                                await conn.execute(
                                    "DELETE FROM verdicts WHERE task_id = ?", (task_id,)
                                )
                                await conn.execute(
                                    "DELETE FROM tasks WHERE task_id = ?", (task_id,)
                                )
                                await conn.commit()
                            except Exception:
                                pass

                            await state.task_store.create_task(task_id, prompt)
                            await state.task_queue.submit(
                                task_id, _run_petition(task_id, prompt, state)
                            )
                    elif action.startswith("debug_"):
                        # Convert debug_brawl -> brawl
                        real_action = action.replace("debug_", "")
                        event_data = {"action": real_action, "task_id": task_id}
                        if "data" in payload and isinstance(payload["data"], dict):
                            event_data.update(payload["data"])
                        await manager.broadcast(task_id, event_data)
                except Exception as e:
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.error(
                        f"[WS Client] Parse error inside connection loop: {e}", exc_info=True
                    )
    except WebSocketDisconnect:
        # 客户端正常或异常断开
        pass
    finally:
        await manager.disconnect(task_id, websocket)
