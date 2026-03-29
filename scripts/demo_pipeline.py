#!/usr/bin/env python3
"""CLI Demo — 端到端 Pipeline 演示。

使用方式（macOS）：
    .venv/bin/python scripts/demo_pipeline.py "帮我写一个 Python 冒泡排序"
    .venv/bin/python scripts/demo_pipeline.py

注意：LLM 调用使用 Mock（返回空字符串），不依赖真实 API Key。
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# 将项目根目录加入 sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from openclaw_republic.government import CyberGovernment  # noqa: E402


async def main(petition: str) -> None:
    """运行端到端 Pipeline。"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config_dir = PROJECT_ROOT / "config"
    gov = CyberGovernment(config_dir=config_dir)

    print("=" * 60)
    print("OpenClaw Republic — 端到端 Pipeline Demo")
    print("=" * 60)
    print(f"\n📜 选民请愿: {petition}\n")

    await gov.inaugurate()

    try:
        result = await gov.receive_petition(petition)
        print("\n" + "=" * 60)
        print("📋 最终结果:")
        print("=" * 60)
        print(result)

        # 打印事件日志统计
        events = gov.event_logger.export_for_websocket()
        print(f"\n📊 总事件数: {len(events)}")
    finally:
        await gov.shutdown()


if __name__ == "__main__":
    default_petition = "帮我写一个 Python 冒泡排序"
    user_petition = sys.argv[1] if len(sys.argv) > 1 else default_petition
    asyncio.run(main(user_petition))
