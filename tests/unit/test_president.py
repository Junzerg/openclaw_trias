"""单元测试 — 总统 Agent (President)。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.base import Branch, Permission
from openclaw_republic.agents.executive.president import President
from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ActVoteRecord,
    DebateRecord,
    ExecutionTask,
)


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_act(
    *,
    total_tokens: int = 10_000,
    skills: list[str] | None = None,
    act_id: str = "act-001",
) -> Act:
    """创建测试用法案。"""
    if skills is None:
        skills = ["CodeExecution"]
    steps = [
        ActStep(
            index=i,
            description=f"步骤 {i}",
            required_skill=skill,
            estimated_tokens=total_tokens // len(skills),
            acceptance_criteria="完成",
        )
        for i, skill in enumerate(skills)
    ]
    return Act(
        act_id=act_id,
        title="测试法案",
        summary="用于单测的法案",
        petition_origin="请帮我写代码",
        steps=steps,
        total_estimated_tokens=total_tokens,
        debate_record=DebateRecord(
            total_rounds=2,
            final_conflict_score=15.0,
        ),
        vote_record=ActVoteRecord(
            ayes=2, nays=0, result="passed",
        ),
    )


# ---------------------------------------------------------------------------
# 初始化与权限
# ---------------------------------------------------------------------------


class TestPresidentInit:
    """President 初始化测试。"""

    def test_default_init(self) -> None:
        """默认初始化属性正确。"""
        p = President()
        assert p.name == "President"
        assert p.role == "president"
        assert p.branch == Branch.EXECUTIVE
        assert p.has_permission(Permission.PLAN)
        assert p.has_permission(Permission.VETO)

    def test_no_execute_permission(self) -> None:
        """总统不拥有 EXECUTE 权限。"""
        p = President()
        assert not p.has_permission(Permission.EXECUTE)

    def test_no_kill_permission(self) -> None:
        """总统不拥有 KILL 权限。"""
        p = President()
        assert not p.has_permission(Permission.KILL)

    def test_no_monitor_permission(self) -> None:
        """总统不拥有 MONITOR 权限。"""
        p = President()
        assert not p.has_permission(Permission.MONITOR)

    def test_custom_token_budget(self) -> None:
        """可自定义 Token 预算。"""
        p = President(token_budget=20_000)
        assert p._token_budget == 20_000

    def test_custom_available_skills(self) -> None:
        """可自定义可用 Skill 集合。"""
        p = President(available_skills={"CodeExecution", "Search"})
        assert p._available_skills == {"CodeExecution", "Search"}


# ---------------------------------------------------------------------------
# review_act — 签署
# ---------------------------------------------------------------------------


class TestReviewActSign:
    """review_act 签署场景测试。"""

    @pytest.mark.asyncio
    async def test_sign_when_budget_and_skills_ok(self) -> None:
        """Token 充足且 Skill 可用时签署法案。"""
        p = President(token_budget=50_000)
        act = _make_act(total_tokens=10_000, skills=["CodeExecution"])
        result = await p.review_act(act)
        assert result is None  # None = 签署

    @pytest.mark.asyncio
    async def test_sign_multi_skill(self) -> None:
        """多 Skill 法案全部可用时签署。"""
        p = President(
            token_budget=50_000,
            available_skills={"CodeExecution", "Search", "WebBrowser"},
        )
        act = _make_act(
            total_tokens=9_000,
            skills=["CodeExecution", "Search", "WebBrowser"],
        )
        result = await p.review_act(act)
        assert result is None

    @pytest.mark.asyncio
    async def test_sign_exact_budget(self) -> None:
        """Token 恰好等于预算时签署。"""
        p = President(token_budget=10_000)
        act = _make_act(total_tokens=10_000)
        result = await p.review_act(act)
        assert result is None


# ---------------------------------------------------------------------------
# dispatch_tasks
# ---------------------------------------------------------------------------


class TestDispatchTasks:
    """dispatch_tasks 测试。"""

    @pytest.mark.asyncio
    async def test_dispatch_creates_correct_count(self) -> None:
        """分派任务数量等于法案步骤数。"""
        p = President()
        act = _make_act(skills=["CodeExecution", "Search"])
        tasks = await p.dispatch_tasks(act)
        assert len(tasks) == 2

    @pytest.mark.asyncio
    async def test_dispatch_assigns_correct_roles(self) -> None:
        """分派任务指向正确的部长。"""
        p = President()
        act = _make_act(skills=["CodeExecution", "Search"])
        tasks = await p.dispatch_tasks(act)
        roles = {t.assigned_to for t in tasks}
        assert "sec_engineering" in roles
        assert "sec_state" in roles

    @pytest.mark.asyncio
    async def test_dispatch_task_ids_unique(self) -> None:
        """每个任务的 task_id 唯一。"""
        p = President()
        act = _make_act(skills=["CodeExecution", "Search", "GitHub"])
        tasks = await p.dispatch_tasks(act)
        ids = [t.task_id for t in tasks]
        assert len(ids) == len(set(ids))

    @pytest.mark.asyncio
    async def test_dispatch_preserves_act_id(self) -> None:
        """任务的 act_id 与法案一致。"""
        p = President()
        act = _make_act(act_id="act-xyz")
        tasks = await p.dispatch_tasks(act)
        assert all(t.act_id == "act-xyz" for t in tasks)

    @pytest.mark.asyncio
    async def test_dispatch_returns_execution_tasks(self) -> None:
        """返回的每个元素都是 ExecutionTask 实例。"""
        p = President()
        act = _make_act()
        tasks = await p.dispatch_tasks(act)
        assert all(isinstance(t, ExecutionTask) for t in tasks)

    @pytest.mark.asyncio
    async def test_dispatch_unknown_skill(self) -> None:
        """未知 Skill 分派 role 为 'unknown'。"""
        p = President(
            available_skills={"CodeExecution", "MagicTool"},
            skill_to_role={"CodeExecution": "sec_engineering"},
        )
        act = _make_act(skills=["MagicTool"])
        tasks = await p.dispatch_tasks(act)
        assert tasks[0].assigned_to == "unknown"


# ---------------------------------------------------------------------------
# act() 入口
# ---------------------------------------------------------------------------


class TestPresidentAct:
    """President.act() 入口测试。"""

    @pytest.mark.asyncio
    async def test_act_with_act_object(self) -> None:
        """传入 Act 对象时委托给 review_act。"""
        p = President(token_budget=50_000)
        act = _make_act(total_tokens=5_000)
        result = await p.act(act)
        assert result is None  # 签署

    @pytest.mark.asyncio
    async def test_act_with_wrong_type(self) -> None:
        """传入非 Act 对象时抛出 TypeError。"""
        p = President()
        with pytest.raises(TypeError):
            await p.act("not an act")
