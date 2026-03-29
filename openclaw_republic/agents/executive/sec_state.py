"""国务卿 Agent (Secretary of State) — 外部信息检索与 API 交互。

挂载 WebBrowser、Search 技能，
负责外部信息检索与 API 交互。
"""

from __future__ import annotations

from typing import Any

from openclaw_republic.agents.base import BaseAgent, Branch, Permission
from openclaw_republic.schemas.act import ExecutionTask, TaskResult


class SecretaryOfState(BaseAgent):
    """国务卿 — 负责外部信息获取。"""

    _available_tools = ["WebBrowser", "Search"]

    def __init__(self) -> None:
        super().__init__(
            name="Sec. of State",
            role="sec_state",
            branch=Branch.EXECUTIVE,
            permissions={Permission.EXECUTE},
        )

    async def execute_task(self, task: ExecutionTask) -> TaskResult:
        """执行总统派发的检索任务。

        当前阶段为 Mock 实现 — 校验权限与工具可用性后
        返回成功的 ``TaskResult``。真实工具调用在 Phase 2+ 实现。

        Args:
            task: 总统分派的执行任务。

        Returns:
            执行结果。

        Raises:
            PermissionDeniedError: 无 EXECUTE 权限。
            ValueError: 所需 Skill 不在本部长可用工具集中。
        """
        self.require_permission(Permission.EXECUTE)

        if not self.can_use_tool(task.step.required_skill):
            raise ValueError(
                f"{self.role} 无法使用工具 '{task.step.required_skill}'，可用工具: {self._tools}"
            )

        # Mock 执行 — 模拟消耗 estimated_tokens
        return TaskResult(
            task_id=task.task_id,
            step_index=task.step.index,
            status="success",
            output=f"[Mock] {self.role} 完成步骤 {task.step.index}: {task.step.description}",
            tokens_consumed=task.step.estimated_tokens,
        )

    # ----- BaseAgent.act() 实现 -----

    async def act(self, message: Any) -> Any:
        """核心处理入口。

        Args:
            message: 预期为 ``ExecutionTask`` 实例。

        Returns:
            ``TaskResult``。
        """
        if isinstance(message, ExecutionTask):
            return await self.execute_task(message)
        raise TypeError(f"{self.role} 不接受 {type(message).__name__} 类型消息")
