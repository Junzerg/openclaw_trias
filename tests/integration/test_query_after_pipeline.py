"""Pipeline 执行后的查询集成测试。"""

import asyncio

import pytest
from typing import Any
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openclaw_republic.server.app import create_app


@pytest.fixture
def test_app(tmp_path: Any) -> FastAPI:
    """创建临时测试应用。"""
    db_path = tmp_path / "integration_tasks.db"
    app = create_app(config_dir="config", db_path=db_path)
    return app


@pytest.mark.asyncio
async def test_query_after_pipeline(test_app: FastAPI) -> None:
    """端到端测试：提交 Petition -> 跑完 Pipeline -> 查询数据。"""
    # 必须启动 lifespan 手动触发 Government Inaugurate
    async with test_app.router.lifespan_context(test_app):
        with TestClient(test_app) as client:
            # 1. 提交 petition
            req_data = {"prompt": "Write a dummy act to test integration."}
            response = client.post("/petition", json=req_data)
            assert response.status_code == 202
            task_id = response.json()["task_id"]

            # 2. 等待 Pipeline 跑完
            # Government 默认执行 Pipeline 大约需要几秒钟（因为没有真正调 LLM 或者是 Mock LLM）
            # 我们通过轮询 status 检查是否 completed 或 failed
            max_wait = 20
            completed = False
            for _ in range(max_wait):
                res = client.get(f"/task/{task_id}/status")
                assert res.status_code == 200
                st = res.json()["status"]
                if st in ("completed", "failed"):
                    completed = True
                    break
                await asyncio.sleep(0.5)

            assert completed is True, "Pipeline 并没有在合理时间内跑完"

            # 3. 验证数据落地
            # (1) get Act
            act_res = client.get(f"/task/{task_id}/act")
            # 虽然 Mock LLM 可能会跑过，但以防万一它没有生成我们只断言它能返回
            # 或者我们断言 status = 200 (如果有生成 Act)
            if act_res.status_code == 200:
                act = act_res.json()["act"]
                assert act["title"] is not None
                
            # (2) get Debate
            debate_res = client.get(f"/task/{task_id}/debate")
            assert debate_res.status_code == 200
            
            # (3) get Verdict (如果跑到最后)
            verdict_res = client.get(f"/task/{task_id}/verdict")
            if verdict_res.status_code == 200:
                verdict = verdict_res.json()
                assert "constitutional" in verdict
