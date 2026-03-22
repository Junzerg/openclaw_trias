"""单元测试 — KillSwitch（物理熔断机制）。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.judicial.kill_switch import KillSwitch
from openclaw_republic.schemas.verdict import KillReport, Verdict, ViolationType


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_verdict(
    *,
    constitutional: bool = False,
    violation_type: ViolationType | None = ViolationType.BLACKLIST_COMMAND,
    evidence: list[str] | None = None,
) -> Verdict:
    return Verdict(
        verdict_id="v-kill-001",
        act_id="act-kill-001",
        constitutional=constitutional,
        ruling="违宪：包含危险命令",
        violation_type=violation_type,
        evidence=evidence or ["命令 rm -rf 命中黑名单"],
        remediation="禁止使用危险命令",
    )


# ---------------------------------------------------------------------------
# 测试
# ---------------------------------------------------------------------------


class TestKillSwitchExecute:
    """KillSwitch.execute() 测试。"""

    @pytest.mark.asyncio
    async def test_returns_kill_report(self) -> None:
        """执行熔断返回 KillReport。"""
        ks = KillSwitch()
        verdict = _make_verdict()
        report = await ks.execute(verdict)
        assert isinstance(report, KillReport)

    @pytest.mark.asyncio
    async def test_killed_processes(self) -> None:
        """包含模拟终止的进程。"""
        ks = KillSwitch()
        verdict = _make_verdict()
        report = await ks.execute(verdict)
        assert len(report.killed_processes) > 0
        assert verdict.act_id in report.killed_processes[0]

    @pytest.mark.asyncio
    async def test_rollback_success(self) -> None:
        """Mock 回滚总是成功。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert report.rollback_success is True

    @pytest.mark.asyncio
    async def test_verdict_preserved(self) -> None:
        """判决信息保留在报告中。"""
        ks = KillSwitch()
        verdict = _make_verdict()
        report = await ks.execute(verdict)
        assert report.verdict.verdict_id == verdict.verdict_id
        assert report.verdict.act_id == verdict.act_id


class TestJudgmentDocument:
    """判决书文本生成。"""

    @pytest.mark.asyncio
    async def test_contains_verdict_id(self) -> None:
        """判决书包含判决编号。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert "v-kill-001" in report.judgment_document

    @pytest.mark.asyncio
    async def test_contains_act_id(self) -> None:
        """判决书包含法案编号。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert "act-kill-001" in report.judgment_document

    @pytest.mark.asyncio
    async def test_contains_ruling(self) -> None:
        """判决书包含判决结果。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert "违宪" in report.judgment_document or "UNCONSTITUTIONAL" in report.judgment_document

    @pytest.mark.asyncio
    async def test_contains_violation_type(self) -> None:
        """判决书包含违宪类型。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert "blacklist_command" in report.judgment_document

    @pytest.mark.asyncio
    async def test_contains_evidence(self) -> None:
        """判决书包含证据。"""
        ks = KillSwitch()
        report = await ks.execute(
            _make_verdict(evidence=["证据1: rm -rf 检测", "证据2: 越权操作"]),
        )
        assert "证据1" in report.judgment_document
        assert "证据2" in report.judgment_document

    @pytest.mark.asyncio
    async def test_contains_remediation(self) -> None:
        """判决书包含补救建议。"""
        ks = KillSwitch()
        report = await ks.execute(_make_verdict())
        assert "禁止使用危险命令" in report.judgment_document

    @pytest.mark.asyncio
    async def test_constitutional_verdict_document(self) -> None:
        """合宪判决的判决书。"""
        ks = KillSwitch()
        verdict = Verdict(
            verdict_id="v-ok",
            act_id="act-ok",
            constitutional=True,
            ruling="合宪",
        )
        report = await ks.execute(verdict)
        assert "合宪" in report.judgment_document or "CONSTITUTIONAL" in report.judgment_document
