"""单元测试 — 工程部长 Agent (SecretaryOfEngineering)。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.base import Branch, Permission
from openclaw_republic.agents.executive.sec_engineering import SecretaryOfEngineering
from openclaw_republic.schemas.act import ActStep, ExecutionTask, TaskResult


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


def _make_task(*, skill: str = "CodeExecution", index: int = 0) -> ExecutionTask:
    """创建测试用 ExecutionTask。"""
    return ExecutionTask(
        task_id="task-eng-001",
        act_id="act-001",
        step=ActStep(
            index=index,
            description=f"测试步骤 {index}",
            required_skill=skill,
            estimated_tokens=3000,
            acceptance_criteria="完成",
        ),
        assigned_to="sec_engineering",
    )


# ---------------------------------------------------------------------------
# 初始化与权限
# ---------------------------------------------------------------------------


class TestSecEngineeringInit:
    """SecretaryOfEngineering 初始化测试。"""

    def test_basic_attributes(self) -> None:
        """基本属性正确。"""
        sec = SecretaryOfEngineering()
        assert sec.name == "Sec. of Engineering"
        assert sec.role == "sec_engineering"
        assert sec.branch == Branch.EXECUTIVE

    def test_has_execute_permission(self) -> None:
        """拥有 EXECUTE 权限。"""
        sec = SecretaryOfEngineering()
        assert sec.has_permission(Permission.EXECUTE)

    def test_no_plan_permission(self) -> None:
        """不拥有 PLAN 权限。"""
        sec = SecretaryOfEngineering()
        assert not sec.has_permission(Permission.PLAN)

    def test_no_veto_permission(self) -> None:
        """不拥有 VETO 权限。"""
        sec = SecretaryOfEngineering()
        assert not sec.has_permission(Permission.VETO)

    def test_no_kill_permission(self) -> None:
        """不拥有 KILL 权限。"""
        sec = SecretaryOfEngineering()
        assert not sec.has_permission(Permission.KILL)


# ---------------------------------------------------------------------------
# 工具挂载
# ---------------------------------------------------------------------------


class TestSecEngineeringTools:
    """工程部长工具挂载测试。"""

    def test_can_use_code_execution(self) -> None:
        sec = SecretaryOfEngineering()
        assert sec.can_use_tool("CodeExecution")

    def test_can_use_python_interpreter(self) -> None:
        sec = SecretaryOfEngineering()
        assert sec.can_use_tool("Python_Interpreter")

    def test_can_use_github(self) -> None:
        sec = SecretaryOfEngineering()
        assert sec.can_use_tool("GitHub")

    def test_cannot_use_web_browser(self) -> None:
        """不能使用 WebBrowser（国务卿专属）。"""
        sec = SecretaryOfEngineering()
        assert not sec.can_use_tool("WebBrowser")

    def test_cannot_use_search(self) -> None:
        """不能使用 Search（国务卿专属）。"""
        sec = SecretaryOfEngineering()
        assert not sec.can_use_tool("Search")


# ---------------------------------------------------------------------------
# execute_task
# ---------------------------------------------------------------------------


class TestSecEngineeringExecuteTask:
    """execute_task 测试。"""

    @pytest.mark.asyncio
    async def test_success(self) -> None:
        """正常执行返回成功 TaskResult。"""
        sec = SecretaryOfEngineering()
        task = _make_task(skill="CodeExecution")
        result = await sec.execute_task(task)
        assert isinstance(result, TaskResult)
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_tokens_consumed(self) -> None:
        """消耗的 Token 数等于步骤预估值。"""
        sec = SecretaryOfEngineering()
        task = _make_task(skill="CodeExecution")
        result = await sec.execute_task(task)
        assert result.tokens_consumed == 3000

    @pytest.mark.asyncio
    async def test_step_index_preserved(self) -> None:
        """结果中的 step_index 与原任务一致。"""
        sec = SecretaryOfEngineering()
        task = _make_task(skill="Python_Interpreter", index=5)
        result = await sec.execute_task(task)
        assert result.step_index == 5

    @pytest.mark.asyncio
    async def test_task_id_preserved(self) -> None:
        """结果中的 task_id 与原任务一致。"""
        sec = SecretaryOfEngineering()
        task = _make_task()
        result = await sec.execute_task(task)
        assert result.task_id == "task-eng-001"

    @pytest.mark.asyncio
    async def test_rejects_unavailable_tool(self) -> None:
        """所需 Skill 不在可用工具列表时抛出 ValueError。"""
        sec = SecretaryOfEngineering()
        task = _make_task(skill="WebBrowser")
        with pytest.raises(ValueError, match="无法使用工具"):
            await sec.execute_task(task)

    @pytest.mark.asyncio
    async def test_output_non_empty(self) -> None:
        """成功执行的输出不为空。"""
        sec = SecretaryOfEngineering()
        task = _make_task()
        result = await sec.execute_task(task)
        assert len(result.output) > 0


# ---------------------------------------------------------------------------
# act() 入口
# ---------------------------------------------------------------------------


class TestSecEngineeringAct:
    """SecretaryOfEngineering.act() 入口测试。"""

    @pytest.mark.asyncio
    async def test_act_with_execution_task(self) -> None:
        """传入 ExecutionTask 时正常执行。"""
        sec = SecretaryOfEngineering()
        task = _make_task()
        result = await sec.act(task)
        assert isinstance(result, TaskResult)
        assert result.status == "success"

    @pytest.mark.asyncio
    async def test_act_with_wrong_type(self) -> None:
        """传入非 ExecutionTask 时抛出 TypeError。"""
        sec = SecretaryOfEngineering()
        with pytest.raises(TypeError):
            await sec.act("not a task")
