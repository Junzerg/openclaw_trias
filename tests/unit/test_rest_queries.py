"""REST API 路由和查询测试。"""

import json

import pytest
from typing import Any
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openclaw_republic.server.app import create_app


@pytest.fixture
def test_app(tmp_path: Any) -> FastAPI:
    """创建临时测试应用。"""
    db_path = tmp_path / "test_tasks.db"
    app = create_app(config_dir="config", db_path=db_path)
    return app


@pytest.mark.asyncio
async def test_rest_queries(test_app: FastAPI) -> None:
    """测试 REST 查询 API 端点。"""
    with TestClient(test_app) as client:
        # 1. 提交请愿
        response = client.post("/petition", json={"prompt": "test rest queries"})
        assert response.status_code == 202
        task_id = response.json()["task_id"]

        # 2. 查询任务列表
        list_response = client.get("/tasks")
        assert list_response.status_code == 200
        data = list_response.json()
        assert data["total"] >= 1
        assert any(t["task_id"] == task_id for t in data["tasks"])

        # 因为 Pipeline 还在后台跑，我们需要等待一下（或者直接操作 DB 来制造测试数据）
        # 这里我们在 `client` 发起请求后直接注入测试数据，免得等待 Pipeline
        app_state = test_app.state
        
        # 制造 Act
        act_dict = {"title": "Test Act", "summary": "Testing"}
        await app_state.task_store.store_act(task_id, json.dumps(act_dict))
        
        # 制造 Debate Events
        event1 = {
            "source_agent": "radical_mp",
            "action": "propose",
            "statement": "We must test this",
            "conflict_score": 10.5,
            "round_number": 1
        }
        event2 = {
            "source_agent": "conservative_mp",
            "action": "propose",
            "statement": "Agreed",
            "conflict_score": 5.0,
            "round_number": 1
        }
        await app_state.task_store.store_event(
            task_id, "radical_mp", "propose", payload=json.dumps(event1)
        )
        await app_state.task_store.store_event(
            task_id, "conservative_mp", "propose", payload=json.dumps(event2)
        )
        
        # 制造 Verdict
        evidence = json.dumps(["Ev1", "Ev2"])
        await app_state.task_store.store_verdict(task_id, True, "Valid", evidence)
        
        # 3. 查询 Act
        act_res = client.get(f"/task/{task_id}/act")
        assert act_res.status_code == 200
        assert act_res.json()["act"]["title"] == "Test Act"
        
        # 4. 查询 Debate
        debate_res = client.get(f"/task/{task_id}/debate")
        assert debate_res.status_code == 200
        debate_data = debate_res.json()
        assert len(debate_data["rounds"]) == 1
        assert debate_data["rounds"][0]["radical_statement"] == "We must test this"
        assert debate_data["rounds"][0]["conservative_statement"] == "Agreed"
        assert len(debate_data["conflict_score_curve"]) == 2
        
        # 5. 查询 Verdict
        verdict_res = client.get(f"/task/{task_id}/verdict")
        assert verdict_res.status_code == 200
        verdict_data = verdict_res.json()
        assert verdict_data["constitutional"] is True
        assert verdict_data["ruling"] == "Valid"
        assert len(verdict_data["evidence"]) == 2
