"""FastAPI 应用创建单测。"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from openclaw_republic.server.app import create_app


def test_create_app(tmp_path: Path) -> None:
    """测试 FastAPI 应用工厂创建行为。"""
    db_path = tmp_path / "test_tasks.db"
    
    # 采用项目默认配置文件目录 "config"
    app = create_app(config_dir="config", db_path=db_path)
    
    assert isinstance(app, FastAPI)
    assert app.title == "OpenClaw Republic API"
    
    # 验证中间件、路由和状态初始化
    assert app.state.government is not None
    assert app.state.task_store is not None
    
    # 使用 TestClient 触发 lifespan (启动/关闭 government 和 db)
    with TestClient(app) as client:
        # Swagger
        response = client.get("/docs")
        assert response.status_code == 200
