"""启动 OpenClaw Republic API 服务。

使用方式：
    python scripts/run_server.py
    # 或
    uvicorn openclaw_republic.server.app:create_app --factory --reload
"""

import uvicorn


def main() -> None:
    """启动 uvicorn 服务。"""
    uvicorn.run(
        "openclaw_republic.server.app:create_app",
        factory=True,
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    main()
