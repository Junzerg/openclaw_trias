"""单元测试 — 国务卿 Agent (SecretaryOfState)。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.base import Branch, Permission
from openclaw_republic.agents.executive.sec_state import SecretaryOfState
from openclaw_republic.schemas.act import ActStep, ExecutionTask, TaskResult


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


def _make_task(*, skill: str = "WebBrowser", index: int = 0) -> ExecutionTask:
    """创建测试用 ExecutionTask。"""
    return ExecutionTask(
        task_id="task-state-001",
        act_id="act-001",
        step=ActStep(
            index=index,
            description=f"测试步骤 {index}",
            required_skill=skill,
            estimated_tokens=2000,
            acceptance_criteria="完成",
        ),
        assigned_to="sec_state",
    )


# ---------------------------------------------------------------------------
# 初始化与权限
# ---------------------------------------------------------------------------


class TestSecStateInit:
    """SecretaryOfState 初始化测试。"""

    def test_basic_attributes(self) -> None:
        """基本属性正确。"""
        sec = SecretaryOfState()
        assert sec.name == "Sec. of State"
        assert sec.role == "sec_state"
        assert sec.branch == Branch.EXECUTIVE

    def test_has_execute_permission(self) -> None:
        """拥有 EXECUTE 权限。"""
        sec = SecretaryOfState()
        assert sec.has_permission(Permission.EXECUTE)

    def test_no_plan_permission(self) -> None:
        """不拥有 PLAN 权限。"""
        sec = SecretaryOfState()
        assert not sec.has_permission(Permission.PLAN)

    def test_no_veto_permission(self) -> None:
        """不拥有 VETO 权限。"""
        sec = SecretaryOfState()
        assert not sec.has_permission(Permission.VETO)

    def test_no_kill_permission(self) -> None:
        """不拥有 KILL 权限。"""
        sec = SecretaryOfState()
        assert not sec.has_permission(Permission.KILL)


# ---------------------------------------------------------------------------
# 工具挂载
# ---------------------------------------------------------------------------


class TestSecStateTools:
    """国务卿工具挂载测试。"""

    def test_can_use_web_browser(self) -> None:
        sec = SecretaryOfState()
        assert sec.can_use_tool("WebBrowser")

    def test_can_use_search(self) -> None:
        sec = SecretaryOfState()
        assert sec.can_use_tool("Search")

    def test_cannot_use_code_execution(self) -> None:
        """不能使用 CodeExecution（工程部长专属）。"""
        sec = SecretaryOfState()
        assert not sec.can_use_tool("CodeExecution")

    def test_cannot_use_python_interpreter(self) -> None:
        """不能使用 Python_Interpreter（工程部长专属）。"""
        sec = SecretaryOfState()
        assert not sec.can_use_tool("Python_Interpreter")

    def test_cannot_use_github(self) -> None:
        """不能使用 GitHub（工程部长专属）。"""
        sec = SecretaryOfState()
        assert not sec.can_use_tool("GitHub")


# ---------------------------------------------------------------------------
# execute_task
# ---------------------------------------------------------------------------


class TestSecStateExecuteTask:
    """execute_task 测试。"""

    @pytest.mark.asyncio
    async def test_success(self) -> None:
        """正常执行返回成功 TaskResult。"""
        sec = SecretaryOfState()
        task = _make_task(skill="WebBrowser")
        result = await sec.execute_task(task)
        assert isinstance(result, TaskResult)
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_success_search(self) -> None:
        """Search 技能也能成功执行。"""
        sec = SecretaryOfState()
        task = _make_task(skill="Search")
        result = await sec.execute_task(task)
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_tokens_consumed(self) -> None:
        """消耗的 Token 数等于步骤预估值。"""
        sec = SecretaryOfState()
        task = _make_task(skill="WebBrowser")
        result = await sec.execute_task(task)
        assert result.tokens_consumed == 2000

    @pytest.mark.asyncio
    async def test_step_index_preserved(self) -> None:
        """结果中的 step_index 与原任务一致。"""
        sec = SecretaryOfState()
        task = _make_task(skill="Search", index=3)
        result = await sec.execute_task(task)
        assert result.step_index == 3

    @pytest.mark.asyncio
    async def test_task_id_preserved(self) -> None:
        """结果中的 task_id 与原任务一致。"""
        sec = SecretaryOfState()
        task = _make_task()
        result = await sec.execute_task(task)
        assert result.task_id == "task-state-001"

    @pytest.mark.asyncio
    async def test_rejects_unavailable_tool(self) -> None:
        """所需 Skill 不在可用工具列表时抛出 ValueError。"""
        sec = SecretaryOfState()
        task = _make_task(skill="CodeExecution")
        with pytest.raises(ValueError, match="无法使用工具"):
            await sec.execute_task(task)

    @pytest.mark.asyncio
    async def test_output_non_empty(self) -> None:
        """成功执行的输出不为空。"""
        sec = SecretaryOfState()
        task = _make_task()
        result = await sec.execute_task(task)
        assert len(result.output) > 0


# ---------------------------------------------------------------------------
# act() 入口
# ---------------------------------------------------------------------------


class TestSecStateAct:
    """SecretaryOfState.act() 入口测试。"""

    @pytest.mark.asyncio
    async def test_act_with_execution_task(self) -> None:
        """传入 ExecutionTask 时正常执行。"""
        sec = SecretaryOfState()
        task = _make_task()
        result = await sec.act(task)
        assert isinstance(result, TaskResult)
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_act_with_wrong_type(self) -> None:
        """传入非 ExecutionTask 时抛出 TypeError。"""
        sec = SecretaryOfState()
        with pytest.raises(TypeError):
            await sec.act("not a task")
