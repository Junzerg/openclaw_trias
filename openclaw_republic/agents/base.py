"""Agent 基类 — 所有 Agent 的公共抽象与 RBAC 权限模型。"""

from __future__ import annotations

import uuid
from enum import Enum
from pathlib import Path
from typing import Any, ClassVar

from openclaw_republic.config.loader import extract_system_prompt, soul_cache
from openclaw_republic.schemas.events import BaseEvent, EventAction


# ---------------------------------------------------------------------------
# 权限与分支枚举
# ---------------------------------------------------------------------------


class Permission(str, Enum):
    """系统权限枚举 — 与 constitution.yaml RBAC 矩阵一一对应。"""

    PLAN = "PLAN"  # 规划权 — 生成/修改方案
    EXECUTE = "EXECUTE"  # 执行权 — 调用底层工具
    MONITOR = "MONITOR"  # 监控权 — 只读监听
    VETO = "VETO"  # 否决权 — 打回法案
    KILL = "KILL"  # 熔断权 — 强制终止


class Branch(str, Enum):
    """三权分支枚举。"""

    LEGISLATIVE = "legislative"
    EXECUTIVE = "executive"
    JUDICIAL = "judicial"


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class PermissionDeniedError(Exception):
    """权限不足时抛出。"""


# ---------------------------------------------------------------------------
# BaseAgent
# ---------------------------------------------------------------------------


class BaseAgent:
    """Agent 基类。

    定义所有 Agent 共享的接口：SOUL.md 加载、RBAC 校验、消息收发、
    工具注册、事件生成。
    """

    # 子类可声明可用工具（类级别默认为空）
    _available_tools: ClassVar[list[str]] = []

    def __init__(
        self,
        name: str,
        role: str,
        branch: Branch,
        permissions: set[Permission],
        soul_path: Path | None = None,
    ) -> None:
        """初始化 Agent。

        Args:
            name: Agent 名称（如 "议长"）。
            role: Agent 角色标识（如 "speaker"）。
            branch: 所属分支。
            permissions: 该 Agent 拥有的权限集合。
            soul_path: SOUL.md 文件路径（可选）。
        """
        # 基本身份
        self.name = name
        self.role = role
        self.branch = branch

        # RBAC — 冻结权限集，运行时不可变
        self._permissions: frozenset[Permission] = frozenset(permissions)

        # 工具列表（实例级别副本）
        self._tools: list[str] = list(self.__class__._available_tools)

        # SOUL.md → System Prompt
        self.system_prompt: str = ""
        if soul_path is not None:
            self._load_soul(soul_path)

    # ----- RBAC -----

    def has_permission(self, perm: Permission) -> bool:
        """检查是否拥有指定权限。"""
        return perm in self._permissions

    def require_permission(self, perm: Permission) -> None:
        """断言拥有指定权限，否则抛出 PermissionDeniedError。"""
        if not self.has_permission(perm):
            raise PermissionDeniedError(f"{self.role} 不具备 {perm.value} 权限")

    # ----- SOUL.md 加载 -----

    def _load_soul(self, path: Path) -> None:
        """从 SOUL.md 加载 System Prompt（通过 SoulCache）。"""
        full_content = soul_cache.get(path)
        self.system_prompt = extract_system_prompt(full_content)

    # ----- 工具注册 -----

    def register_tools(self, tools: list[str]) -> None:
        """注册此 Agent 可用的工具集。

        Args:
            tools: 工具名称列表。
        """
        self._tools = list(tools)

    def can_use_tool(self, tool_name: str) -> bool:
        """检查此 Agent 是否有权使用指定工具。"""
        return tool_name in self._tools

    # ----- 消息收发 -----

    async def act(self, message: Any) -> Any:
        """核心处理循环 — 子类必须实现。

        Args:
            message: 输入消息（AgentMessage）。

        Returns:
            Agent 的响应（AgentMessage）。
        """
        raise NotImplementedError

    async def receive(self, message: Any) -> Any:
        """接收消息入口 — 权限校验后委托给 act()。

        基类不做自动的分支级权限校验（因为同一分支内的不同角色
        可能拥有不同权限，例如总统是 EXECUTIVE 分支但权限为
        PLAN+VETO 而非 EXECUTE）。子类应在 ``act()`` 中根据
        具体操作调用 ``require_permission()`` 进行细粒度校验。

        Args:
            message: 输入消息。

        Returns:
            Agent 的响应。
        """
        return await self.act(message)

    # ----- 事件生成 -----

    def emit_event(
        self,
        action: EventAction,
        *,
        target_agent: str | None = None,
        task_id: str | None = None,
        **payload: Any,
    ) -> BaseEvent:
        """生成结构化事件。

        Args:
            action: 事件动作类型。
            target_agent: 目标 Agent 角色名（可选）。
            task_id: 关联的任务 ID（可选）。
            **payload: 自由扩展字段。

        Returns:
            构造好的 BaseEvent 实例。
        """
        return BaseEvent(
            source_agent=self.role,
            target_agent=target_agent,
            action=action,
            payload=payload,
            task_id=task_id if task_id is not None else str(uuid.uuid4()),
        )
