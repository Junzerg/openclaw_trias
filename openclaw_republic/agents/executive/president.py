"""总统 Agent (President) — 法案签署 / 否决与任务派发。

职责：接收法案 → Token 预算校验 → Skill 可用性校验 →
行使 Veto 或签署 → 拆解 Task 派发内阁。
"""

from __future__ import annotations

import uuid
from typing import Any

from openclaw_republic.agents.base import BaseAgent, Branch, Permission
from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ExecutionTask,
    VetoNotice,
)


# ---------------------------------------------------------------------------
# Skill → 部长角色映射（默认值）
# ---------------------------------------------------------------------------

_DEFAULT_SKILL_TO_ROLE: dict[str, str] = {
    "CodeExecution": "sec_engineering",
    "Python_Interpreter": "sec_engineering",
    "GitHub": "sec_engineering",
    "WebBrowser": "sec_state",
    "Search": "sec_state",
}


class President(BaseAgent):
    """总统 — 行政分支最高决策者。

    审查议会通过的法案，根据 Token 预算与 Skill 可用性
    决定签署或否决；签署后拆解为 ``ExecutionTask`` 分派内阁。
    """

    def __init__(
        self,
        *,
        token_budget: int = 50_000,
        available_skills: set[str] | None = None,
        skill_to_role: dict[str, str] | None = None,
    ) -> None:
        """初始化总统 Agent。

        Args:
            token_budget: 行政执行的最大 Token 预算。
            available_skills: 内阁当前可提供的 Skill 集合。
                              若为 ``None``，则使用默认映射中的全部 Skill。
            skill_to_role: Skill 名 → 部长角色名映射。
                           若为 ``None``，使用 ``_DEFAULT_SKILL_TO_ROLE``。
        """
        super().__init__(
            name="President",
            role="president",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN, Permission.VETO},
        )
        self._token_budget = token_budget
        self._skill_to_role = (
            dict(skill_to_role) if skill_to_role is not None else dict(_DEFAULT_SKILL_TO_ROLE)
        )
        self._available_skills: set[str] = (
            set(available_skills) if available_skills is not None else set(self._skill_to_role)
        )

    # ----- 审查 -----

    async def review_act(self, act: Act) -> VetoNotice | None:
        """审查法案，决定签署或否决。

        Returns:
            ``None`` 表示签署；``VetoNotice`` 表示否决。
        """
        self.require_permission(Permission.PLAN)

        issues: list[str] = []

        # 1) Token 预算校验
        budget_issues = self._check_token_budget(act)
        issues.extend(budget_issues)

        # 2) Skill 可用性校验
        skill_issues = self._check_skill_availability(act)
        issues.extend(skill_issues)

        if not issues:
            return None  # 签署

        # 否决
        self.require_permission(Permission.VETO)
        return VetoNotice(
            act_id=act.act_id,
            reason="法案审查未通过，存在以下问题",
            specific_issues=issues,
            suggestion="请修改法案后重新提交",
        )

    # ----- 任务派发 -----

    async def dispatch_tasks(self, act: Act) -> list[ExecutionTask]:
        """将签署后的法案拆解为任务，分派内阁。

        Args:
            act: 已签署的法案。

        Returns:
            ``ExecutionTask`` 列表，每个法案步骤对应一个任务。
        """
        self.require_permission(Permission.PLAN)
        tasks: list[ExecutionTask] = []
        for step in act.steps:
            role = self._resolve_role(step)
            tasks.append(
                ExecutionTask(
                    task_id=str(uuid.uuid4()),
                    act_id=act.act_id,
                    step=step,
                    assigned_to=role,
                )
            )
        return tasks

    # ----- 内部辅助 -----

    def _check_token_budget(self, act: Act) -> list[str]:
        """校验法案 Token 预算是否超限。"""
        issues: list[str] = []
        if act.total_estimated_tokens > self._token_budget:
            issues.append(
                f"法案预估 Token ({act.total_estimated_tokens}) 超出行政预算 ({self._token_budget})"
            )
        return issues

    def _check_skill_availability(self, act: Act) -> list[str]:
        """校验法案所需 Skill 是否全部可用。"""
        issues: list[str] = []
        for step in act.steps:
            if step.required_skill not in self._available_skills:
                issues.append(f"步骤 {step.index} 所需 Skill '{step.required_skill}' 不可用")
        return issues

    def _resolve_role(self, step: ActStep) -> str:
        """根据步骤所需 Skill 确定负责的部长角色名。"""
        role = self._skill_to_role.get(step.required_skill)
        if role is None:
            return "unknown"
        return role

    # ----- BaseAgent.act() 实现 -----

    async def act(self, message: Any) -> Any:
        """核心处理入口 — 接收法案并审查。

        Args:
            message: 预期为 ``Act`` 实例。

        Returns:
            ``VetoNotice | None``。
        """
        if isinstance(message, Act):
            return await self.review_act(message)
        raise TypeError(f"President 不接受 {type(message).__name__} 类型消息")
