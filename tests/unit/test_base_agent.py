"""单元测试 — BaseAgent 基类。"""

from __future__ import annotations

import textwrap

from pathlib import Path

import pytest

from openclaw_republic.agents.base import (
    BaseAgent,
    Branch,
    Permission,
    PermissionDeniedError,
)
from openclaw_republic.config.loader import (
    extract_system_prompt,
    soul_cache,
)
from openclaw_republic.schemas.events import BaseEvent, EventAction

# 项目根目录下的 souls 目录路径
SOULS_DIR = Path(__file__).resolve().parents[2] / "config" / "souls"


class TestBaseAgentInit:
    """BaseAgent 初始化测试。"""

    def test_basic_attributes(self) -> None:
        """初始化后基本属性正确。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert agent.name == "议长"
        assert agent.role == "speaker"
        assert agent.branch == Branch.LEGISLATIVE
        assert agent.has_permission(Permission.PLAN)

    def test_system_prompt_empty_without_soul(self) -> None:
        """未指定 soul_path 时 system_prompt 为空。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert agent.system_prompt == ""


class TestSoulLoading:
    """SOUL.md 加载测试。"""

    def setup_method(self) -> None:
        """每个测试前清除缓存。"""
        soul_cache.invalidate()

    def test_loads_system_prompt(self) -> None:
        """加载真实 SOUL.md 后 system_prompt 非空。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=SOULS_DIR / "speaker.md",
        )
        assert len(agent.system_prompt) > 0

    def test_system_prompt_contains_expected_content(self) -> None:
        """加载的 system_prompt 包含 SOUL.md 中 System Prompt 段落的内容。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=SOULS_DIR / "speaker.md",
        )
        # speaker.md 的 System Prompt 段应包含 "议长" 或 "Speaker"
        assert "Speaker" in agent.system_prompt or "议长" in agent.system_prompt

    def test_system_prompt_excludes_heading(self) -> None:
        """system_prompt 不包含 ## System Prompt 标题行本身。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=SOULS_DIR / "speaker.md",
        )
        assert "## System Prompt" not in agent.system_prompt

    def test_system_prompt_excludes_blockquote_hint(self) -> None:
        """system_prompt 不包含标题后的 blockquote 提示行。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=SOULS_DIR / "speaker.md",
        )
        assert "以下内容将在 Agent 初始化时注入" not in agent.system_prompt

    def test_soul_cache_hit(self) -> None:
        """相同 SOUL.md 第二次加载走缓存。"""
        path = SOULS_DIR / "speaker.md"
        # 第一次加载
        _ = BaseAgent(
            name="a1",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
            soul_path=path,
        )
        # 第二次加载 — 缓存中应存在
        key = str(path.resolve())
        assert key in soul_cache._cache

    def test_nonexistent_soul_raises(self) -> None:
        """不存在的 SOUL.md 抛出 FileNotFoundError。"""
        with pytest.raises(FileNotFoundError):
            BaseAgent(
                name="test",
                role="test",
                branch=Branch.LEGISLATIVE,
                permissions={Permission.PLAN},
                soul_path=SOULS_DIR / "nonexistent.md",
            )


class TestEmitEvent:
    """emit_event() 测试。"""

    def test_returns_base_event(self) -> None:
        """emit_event 返回 BaseEvent 实例。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        event = agent.emit_event(EventAction.PROPOSE)
        assert isinstance(event, BaseEvent)

    def test_source_agent_is_role(self) -> None:
        """事件的 source_agent 为 Agent 的 role。"""
        agent = BaseAgent(
            name="议长",
            role="speaker",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        event = agent.emit_event(EventAction.PROPOSE)
        assert event.source_agent == "speaker"

    def test_action_type(self) -> None:
        """事件的 action 与入参一致。"""
        agent = BaseAgent(
            name="总统",
            role="president",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN, Permission.VETO},
        )
        event = agent.emit_event(EventAction.VETO)
        assert event.action == EventAction.VETO

    def test_payload_forwarded(self) -> None:
        """额外 kwargs 正确传入 payload。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        event = agent.emit_event(EventAction.PROPOSE, reason="test_reason")
        assert event.payload["reason"] == "test_reason"

    def test_target_agent(self) -> None:
        """target_agent 正确传入。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        event = agent.emit_event(EventAction.PROPOSE, target_agent="president")
        assert event.target_agent == "president"

    def test_task_id_explicit(self) -> None:
        """task_id 显式传入时不生成随机 UUID。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        event = agent.emit_event(EventAction.PROPOSE, task_id="my-task-123")
        assert event.task_id == "my-task-123"


class TestToolRegistration:
    """工具注册与隔离测试。"""

    def test_default_no_tools(self) -> None:
        """默认情况下 Agent 无可用工具。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        assert agent.can_use_tool("CodeExecution") is False

    def test_register_tools(self) -> None:
        """注册工具后可以使用。"""
        agent = BaseAgent(
            name="工程部长",
            role="sec_engineering",
            branch=Branch.EXECUTIVE,
            permissions={Permission.EXECUTE},
        )
        agent.register_tools(["CodeExecution", "Python_Interpreter", "GitHub"])
        assert agent.can_use_tool("CodeExecution") is True
        assert agent.can_use_tool("Python_Interpreter") is True
        assert agent.can_use_tool("GitHub") is True

    def test_cannot_use_unregistered_tool(self) -> None:
        """未注册的工具不可使用。"""
        agent = BaseAgent(
            name="工程部长",
            role="sec_engineering",
            branch=Branch.EXECUTIVE,
            permissions={Permission.EXECUTE},
        )
        agent.register_tools(["CodeExecution"])
        assert agent.can_use_tool("WebBrowser") is False

    def test_legislative_no_code_execution(self) -> None:
        """立法 Agent 无法使用 CodeExecution 工具。"""
        agent = BaseAgent(
            name="激进派",
            role="radical_mp",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        # 立法 Agent 不注册任何执行工具
        assert agent.can_use_tool("CodeExecution") is False


class TestAct:
    """act() 方法测试。"""

    @pytest.mark.asyncio
    async def test_raises_not_implemented(self) -> None:
        """基类 act() 抛出 NotImplementedError。"""
        agent = BaseAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        with pytest.raises(NotImplementedError):
            await agent.act("test")


class TestReceive:
    """​receive() 方法测试。"""

    @pytest.mark.asyncio
    async def test_delegates_to_act(self) -> None:
        """​receive() 委托给 act() 并返回其结果。"""

        class _TestAgent(BaseAgent):
            async def act(self, message: object) -> str:
                return "ok"

        agent = _TestAgent(
            name="测试",
            role="test",
            branch=Branch.LEGISLATIVE,
            permissions={Permission.PLAN},
        )
        result = await agent.receive("hello")
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_president_can_receive(self) -> None:
        """总统是 EXECUTIVE 分支但无 EXECUTE 权限，receive 不会抦截。"""

        class _PresidentAgent(BaseAgent):
            async def act(self, message: object) -> str:
                return "signed"

        agent = _PresidentAgent(
            name="总统",
            role="president",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN, Permission.VETO},
        )
        result = await agent.receive("a bill")
        assert result == "signed"

    @pytest.mark.asyncio
    async def test_subclass_can_enforce_permission(self) -> None:
        """子类可在 act() 中自行调用 require_permission() 进行校验。"""

        class _StrictAgent(BaseAgent):
            async def act(self, message: object) -> str:
                self.require_permission(Permission.EXECUTE)
                return "executed"

        agent = _StrictAgent(
            name="测试",
            role="test",
            branch=Branch.EXECUTIVE,
            permissions={Permission.PLAN},  # 没有 EXECUTE
        )
        with pytest.raises(PermissionDeniedError):
            await agent.receive("hello")


class TestExtractSystemPrompt:
    """extract_system_prompt() 边缘情况测试。"""

    def test_no_heading_returns_empty(self) -> None:
        """无 ## System Prompt 标题时返回空字符串。"""
        md = textwrap.dedent("""\
            # Title
            ## Other Section
            Some content here.
        """)
        assert extract_system_prompt(md) == ""

    def test_last_section_extracts_to_eof(self) -> None:
        """## System Prompt 是最后一节时正确提取到 EOF。"""
        md = textwrap.dedent("""\
            # Title
            ## Other
            Stuff.
            ## System Prompt
            Line one.
            Line two.
        """)
        result = extract_system_prompt(md)
        assert "Line one." in result
        assert "Line two." in result

    def test_blockquote_hint_skipped(self) -> None:
        """标题后的 blockquote 提示行被跳过。"""
        md = textwrap.dedent("""\
            ## System Prompt
            > This hint should be skipped.
            Actual prompt content.
        """)
        result = extract_system_prompt(md)
        assert "hint should be skipped" not in result
        assert "Actual prompt content." in result

    def test_stops_at_next_heading(self) -> None:
        """遇到下一个标题时停止提取。"""
        md = textwrap.dedent("""\
            ## System Prompt
            Prompt content.
            ## Next Section
            Should not be included.
        """)
        result = extract_system_prompt(md)
        assert "Prompt content." in result
        assert "Should not be included" not in result

    def test_preserves_sub_headings(self) -> None:
        """### 子标题属于 System Prompt 内容，不应终止提取。"""
        md = textwrap.dedent("""\
            ## System Prompt
            Intro.
            ### Sub Section
            Detail under sub heading.
        """)
        result = extract_system_prompt(md)
        assert "Intro." in result
        assert "### Sub Section" in result
        assert "Detail under sub heading." in result


class TestSoulCacheInvalidate:
    """SoulCache.invalidate() 测试。"""

    def setup_method(self) -> None:
        """每个测试前清除并预热缓存。"""
        soul_cache.invalidate()

    def test_invalidate_single(self) -> None:
        """指定路径只清除该条目。"""
        path_speaker = SOULS_DIR / "speaker.md"
        path_president = SOULS_DIR / "president.md"
        soul_cache.get(path_speaker)
        soul_cache.get(path_president)
        assert len(soul_cache._cache) >= 2

        soul_cache.invalidate(path_speaker)
        key_speaker = str(path_speaker.resolve())
        key_president = str(path_president.resolve())
        assert key_speaker not in soul_cache._cache
        assert key_president in soul_cache._cache

    def test_invalidate_all(self) -> None:
        """无参数调用清除全部缓存。"""
        soul_cache.get(SOULS_DIR / "speaker.md")
        soul_cache.get(SOULS_DIR / "president.md")
        assert len(soul_cache._cache) >= 2

        soul_cache.invalidate()
        assert len(soul_cache._cache) == 0
