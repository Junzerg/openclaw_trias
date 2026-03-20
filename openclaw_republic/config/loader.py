"""配置加载器 — 加载 constitution.yaml 与 SOUL.md 人设文件。"""

from __future__ import annotations

from pathlib import Path


def load_constitution(path: str | Path = "config/constitution.yaml") -> dict:
    """加载宪法配置文件。

    Args:
        path: constitution.yaml 文件路径。

    Returns:
        解析后的配置字典。
    """
    raise NotImplementedError


def load_soul(path: str | Path) -> str:
    """加载 SOUL.md 人设文件。

    Args:
        path: SOUL.md 文件路径。

    Returns:
        SOUL.md 文件内容。
    """
    raise NotImplementedError
