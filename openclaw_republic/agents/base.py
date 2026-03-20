"""Agent 基类 — 所有 Agent 的公共抽象与 RBAC 权限模型。"""

from __future__ import annotations

from typing import Any


class BaseAgent:
    """Agent 基类。

    定义所有 Agent 共享的接口：SOUL.md 加载、LLM 调用、权限声明、消息收发。
    """

    def __init__(self, name: str, role: str) -> None:
        """初始化 Agent。

        Args:
            name: Agent 名称。
            role: Agent 角色标识。
        """
        self.name = name
        self.role = role

    async def act(self, message: Any) -> Any:
        """处理一条消息并返回响应。

        Args:
            message: 输入消息。

        Returns:
            Agent 的响应。
        """
        raise NotImplementedError
