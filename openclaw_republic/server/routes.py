"""REST API 路由 — 选民请愿提交、任务状态查询等。"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import json
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field

from openclaw_republic.server.task_store import TaskStatus
from openclaw_republic.server.schemas import (
    TaskListResponse,
    TaskSummary,
    ActResponse,
    DebateResponse,
    DebateRound,
    VerdictResponse,
)

if TYPE_CHECKING:
    from fastapi import FastAPI
    from openclaw_republic.server.app import AppState


logger = logging.getLogger(__name__)

router = APIRouter()


# 请求/响应模型
class PetitionRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="选民请愿内容")


class PetitionResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    petition: str
    status: str
    bill_state: str
    result: str | None
    created_at: datetime
    updated_at: datetime


async def _run_petition(task_id: str, prompt: str, state: AppState) -> None:
    """后台运行请愿 Pipeline。"""
    try:
        await state.task_store.update_task(task_id, status=TaskStatus.RUNNING)
        result = await state.government.receive_petition(prompt, task_id=task_id)
        await state.task_store.update_task(
            task_id,
            status=TaskStatus.COMPLETED,
            result=result,
        )
    except Exception as e:
        logger.error("请愿任务执行失败: %s", str(e), exc_info=True)
        await state.task_store.update_task(
            task_id,
            status=TaskStatus.FAILED,
            result=str(e),
        )


@router.post("/petition", response_model=PetitionResponse, status_code=202)
async def submit_petition(req: PetitionRequest, request: Request) -> PetitionResponse:
    """接收选民 Prompt，创建任务，后台触发三权状态机。"""
    task_id = str(uuid.uuid4())
    state: AppState = request.app.state

    # 存储到 SQLite
    await state.task_store.create_task(task_id, req.prompt)

    # 后台排队启动 Pipeline
    await state.task_queue.submit(task_id, _run_petition(task_id, req.prompt, state))

    return PetitionResponse(
        task_id=task_id,
        status="pending",
        message="请愿已提交，三权状态机已启动",
    )


@router.get("/task/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, request: Request) -> TaskStatusResponse:
    """查询法案当前生命周期状态。"""
    state: AppState = request.app.state
    record = await state.task_store.get_task(task_id)

    if not record:
        raise HTTPException(status_code=404, detail="Task not found")

    return TaskStatusResponse(
        task_id=record.task_id,
        petition=record.petition,
        status=record.status.value,
        bill_state=record.bill_state,
        result=record.result,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> TaskListResponse:
    """分页查询历史任务。"""
    state: AppState = request.app.state
    total = await state.task_store.count_tasks()
    records = await state.task_store.list_tasks(offset, limit)

    tasks = [
        TaskSummary(
            task_id=r.task_id,
            petition=r.petition[:100] + ("..." if len(r.petition) > 100 else ""),
            status=r.status.value,
            bill_state=r.bill_state,
            created_at=r.created_at,
        )
        for r in records
    ]
    return TaskListResponse(total=total, offset=offset, limit=limit, tasks=tasks)


@router.get("/task/{task_id}/act", response_model=ActResponse)
async def get_task_act(task_id: str, request: Request) -> ActResponse:
    """查看法案 JSON 内容。"""
    state: AppState = request.app.state
    act_row = await state.task_store.get_task_act(task_id)
    if not act_row:
        raise HTTPException(status_code=404, detail="Act not found for this task")

    act_dict = json.loads(act_row["act_json"])
    # Return as ActResponse
    return ActResponse(
        task_id=task_id, act=act_dict, created_at=datetime.fromisoformat(act_row["created_at"])
    )


@router.get("/task/{task_id}/debate", response_model=DebateResponse)
async def get_task_debate(task_id: str, request: Request) -> DebateResponse:
    """查询辩论日志 + Conflict Score 曲线数据。"""
    state: AppState = request.app.state
    events_rows = await state.task_store.get_task_events(task_id)

    rounds: list[DebateRound] = []
    conflict_scores: list[float] = []

    for row in events_rows:
        action = row["action"]
        if action == "propose":
            payload_str = row["payload"]
            payload = json.loads(payload_str) if payload_str else {}

            statement = payload.get("statement", "")
            conflict_score = payload.get("conflict_score", 0.0)
            round_num = payload.get("round_number", 1)

            while len(rounds) < round_num:
                rounds.append(DebateRound(round_number=len(rounds) + 1))

            r = rounds[round_num - 1]
            if row["source_agent"] == "conservative_mp":
                r.conservative_statement = statement
            else:
                r.radical_statement = statement

            r.conflict_score = conflict_score
            conflict_scores.append(conflict_score)

    return DebateResponse(task_id=task_id, rounds=rounds, conflict_score_curve=conflict_scores)


@router.get("/task/{task_id}/verdict", response_model=VerdictResponse)
async def get_task_verdict(task_id: str, request: Request) -> VerdictResponse:
    """查询司法判决详情。"""
    state: AppState = request.app.state
    verdict_row = await state.task_store.get_task_verdict(task_id)
    if not verdict_row:
        raise HTTPException(status_code=404, detail="Verdict not found for this task")

    return VerdictResponse(
        task_id=task_id,
        constitutional=bool(verdict_row["constitutional"]),
        ruling=verdict_row["ruling"],
        evidence=json.loads(verdict_row["evidence"]),
        created_at=datetime.fromisoformat(verdict_row["created_at"]),
    )


def register_routes(app: FastAPI) -> None:
    """注册所有 REST API 路由。

    Args:
        app: FastAPI 应用实例。
    """
    app.include_router(router)
