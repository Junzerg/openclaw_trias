# mypy: ignore-errors
"""端到端 Pipeline 集成测试。

测试 CyberGovernment 的完整 Pipeline 流程，
包括 happy path、Veto 回路和违宪回路。
"""

from __future__ import annotations

from pathlib import Path
import pytest

from openclaw_republic.config.loader import load_constitution
from openclaw_republic.government import CyberGovernment
from openclaw_republic.schemas.act import VetoNotice
from openclaw_republic.schemas.verdict import (
    DeviationResult,
    ResultReviewResult,
    Verdict,
    ViolationType,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"


@pytest.fixture
def constitution():  # type: ignore[no-untyped-def]
    """加载宪法配置。"""
    return load_constitution(CONFIG_DIR / "constitution.yaml")


@pytest.fixture
def government(constitution):  # type: ignore[no-untyped-def]
    """创建 CyberGovernment 实例。"""
    return CyberGovernment(
        config_dir=CONFIG_DIR,
        constitution=constitution,
    )


# ---------------------------------------------------------------------------
# Happy Path
# ---------------------------------------------------------------------------


class TestPipelineHappyPath:
    """完整 Pipeline 集成测试 — Happy Path。

    Petition → Debate → Vote → Sign → Execute → Review → Deliver
    """

    @pytest.mark.asyncio
    async def test_full_pipeline(self, government: CyberGovernment) -> None:
        """完整 Pipeline 端到端。

        Mock LLM 返回空字符串，但 Pipeline 能正常走完：
        - 辩论（空字符串 → conflict_score 0 → 立即共识）
        - 投票（空字符串 → 默认不赞成/反对逻辑 → 依实现而定）
        - 总统签署（Token 预算和 Skill 可用性 OK → 签署）
        - 执行（Mock 执行成功）
        - 司法审查（偏离度评分 → 取决于 scorer）
        """
        await government.inaugurate()

        try:
            result = await government.receive_petition(
                "帮我写一个 Python 冒泡排序",
            )

            # 应该成功交付或在 max_retries 后停止
            assert isinstance(result, str)
            assert len(result) > 0
        finally:
            await government.shutdown()

    @pytest.mark.asyncio
    async def test_event_logger_records_events(
        self,
        government: CyberGovernment,
    ) -> None:
        """Pipeline 执行过程中事件日志应有记录。"""
        await government.inaugurate()

        try:
            await government.receive_petition("测试请愿")
            assert government.event_logger.count > 0
        finally:
            await government.shutdown()


# ---------------------------------------------------------------------------
# Veto 回路
# ---------------------------------------------------------------------------


class TestPipelineVetoLoop:
    """Veto 回路测试：法案被否决 → 回到 Drafting → 重新起草。"""

    @pytest.mark.asyncio
    async def test_veto_then_pass(self, government: CyberGovernment) -> None:
        """第一次否决，第二次通过。"""
        call_count = 0
        original_review = government.president.review_act

        async def mock_review(act):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # 第一次：否决
                return VetoNotice(
                    act_id=act.act_id,
                    reason="Token 预算不足",
                    specific_issues=["预估 Token 过高"],
                    suggestion="请减少步骤数量",
                )
            # 第二次及以后：签署
            return await original_review(act)

        government.president.review_act = mock_review  

        await government.inaugurate()
        try:
            result = await government.receive_petition("Veto 回路测试")
            assert isinstance(result, str)
            # 应该经过了 2 轮
            assert call_count >= 2  # noqa: PLR2004
        finally:
            await government.shutdown()


# ---------------------------------------------------------------------------
# 违宪回路
# ---------------------------------------------------------------------------


class TestPipelineUnconstitutionalLoop:
    """违宪回路测试：执行结果违宪 → 回到 Drafting。"""

    @pytest.mark.asyncio
    async def test_unconstitutional_then_pass(
        self,
        government: CyberGovernment,
    ) -> None:
        """第一次违宪，第二次合宪。"""
        call_count = 0
        original_review = government.chief_justice.review_result

        async def mock_review(petition, report):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # 第一次：违宪
                return Verdict(
                    verdict_id="test-verdict-unconst",
                    act_id=report.act_id,
                    constitutional=False,
                    ruling="执行结果违宪，产出偏离度超标",
                    violation_type=ViolationType.DEVIATION_EXCEEDED,
                    evidence=["偏离度 0.9 > 0.3"],
                    result_review=ResultReviewResult(
                        deviation=DeviationResult(
                            score=0.9,
                            passed=False,
                            explanation="偏离度过高",
                        ),
                        passed=False,
                    ),
                    remediation="请细化请愿描述",
                )
            # 第二次：合宪
            return await original_review(petition, report)

        government.chief_justice.review_result = mock_review  

        await government.inaugurate()
        try:
            result = await government.receive_petition("违宪回路测试")
            assert isinstance(result, str)
            assert call_count >= 2  # noqa: PLR2004
        finally:
            await government.shutdown()


# ---------------------------------------------------------------------------
# Max Retries
# ---------------------------------------------------------------------------


class TestPipelineMaxRetries:
    """测试 max_retries 防止无限循环。"""

    @pytest.mark.asyncio
    async def test_max_retries_exhausted(
        self,
        government: CyberGovernment,
    ) -> None:
        """始终否决 → 达到 max_retries 后停止。"""

        async def always_veto(act):  # type: ignore[no-untyped-def]
            return VetoNotice(
                act_id=act.act_id,
                reason="始终否决",
                specific_issues=["测试用否决"],
            )

        government.president.review_act = always_veto  

        await government.inaugurate()
        try:
            result = await government.receive_petition(
                "max retries 测试",
                max_retries=2,
            )
            assert "2 次重试" in result
        finally:
            await government.shutdown()


# ---------------------------------------------------------------------------
# Bus 与 EventLogger 集成
# ---------------------------------------------------------------------------


class TestBusIntegration:
    """消息总线与事件日志集成测试。"""

    @pytest.mark.asyncio
    async def test_bus_lifecycle(self, government: CyberGovernment) -> None:
        """Bus 启动/停止生命周期。"""
        assert not government.bus.is_running
        await government.inaugurate()
        assert government.bus.is_running
        await government.shutdown()
        assert not government.bus.is_running

    @pytest.mark.asyncio
    async def test_websocket_export_format(
        self,
        government: CyberGovernment,
    ) -> None:
        """事件可导出为 WebSocket 格式。"""
        await government.inaugurate()
        try:
            await government.receive_petition("WebSocket 导出测试")
            exported = government.event_logger.export_for_websocket()
            assert isinstance(exported, list)
            if exported:
                assert isinstance(exported[0], dict)
                assert "source_agent" in exported[0]
                assert "action" in exported[0]
        finally:
            await government.shutdown()
