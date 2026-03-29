# mypy: ignore-errors
"""单元测试 — Verdict Schema（判决数据模型）。"""

from __future__ import annotations

from datetime import datetime, timezone

from openclaw_republic.schemas.verdict import (
    DeviationResult,
    KillReport,
    ProcessReviewResult,
    ResultReviewResult,
    RuleCheckResult,
    Verdict,
    ViolationType,
)


# ---------------------------------------------------------------------------
# ViolationType 枚举
# ---------------------------------------------------------------------------


class TestViolationType:
    """ViolationType 枚举测试。"""

    def test_all_values(self) -> None:
        """覆盖所有 6 种违宪类型。"""
        expected = {
            "blacklist_command",
            "resource_exceeded",
            "deadline_exceeded",
            "file_access_violation",
            "deviation_exceeded",
            "infinite_loop",
        }
        actual = {v.value for v in ViolationType}
        assert actual == expected

    def test_is_str_enum(self) -> None:
        """ViolationType 是 str 子类。"""
        assert isinstance(ViolationType.BLACKLIST_COMMAND, str)
        assert ViolationType.BLACKLIST_COMMAND == "blacklist_command"


# ---------------------------------------------------------------------------
# RuleCheckResult
# ---------------------------------------------------------------------------


class TestRuleCheckResult:
    """RuleCheckResult 模型测试。"""

    def test_passed_result(self) -> None:
        """通过时 violation_detail 为 None。"""
        r = RuleCheckResult(passed=True, rule_name="test_rule")
        assert r.passed is True
        assert r.violation_detail is None

    def test_failed_result(self) -> None:
        """失败时携带 violation_detail。"""
        r = RuleCheckResult(
            passed=False,
            rule_name="blacklist",
            violation_detail="包含 rm -rf",
        )
        assert r.passed is False
        assert r.violation_detail == "包含 rm -rf"

    def test_serialization(self) -> None:
        """可正确序列化。"""
        r = RuleCheckResult(passed=True, rule_name="test")
        d = r.model_dump()
        assert d["passed"] is True
        assert d["rule_name"] == "test"


# ---------------------------------------------------------------------------
# DeviationResult
# ---------------------------------------------------------------------------


class TestDeviationResult:
    """DeviationResult 模型测试。"""

    def test_low_score_passed(self) -> None:
        """低分通过。"""
        r = DeviationResult(score=0.1, passed=True, explanation="ok")
        assert r.passed is True
        assert r.score == 0.1

    def test_high_score_failed(self) -> None:
        """高分未通过。"""
        r = DeviationResult(score=0.9, passed=False, explanation="偏离过大")
        assert r.passed is False

    def test_score_boundaries(self) -> None:
        """评分边界值。"""
        r0 = DeviationResult(score=0.0, passed=True, explanation="")
        r1 = DeviationResult(score=1.0, passed=False, explanation="")
        assert r0.score == 0.0
        assert r1.score == 1.0


# ---------------------------------------------------------------------------
# ProcessReviewResult
# ---------------------------------------------------------------------------


class TestProcessReviewResult:
    """ProcessReviewResult 模型测试。"""

    def test_all_passed(self) -> None:
        """所有检查通过。"""
        r = ProcessReviewResult(
            passed=True,
            checks=[RuleCheckResult(passed=True, rule_name="a")],
        )
        assert r.passed is True
        assert r.violations == []

    def test_with_violations(self) -> None:
        """包含违规项。"""
        r = ProcessReviewResult(
            passed=False,
            checks=[RuleCheckResult(passed=False, rule_name="b", violation_detail="x")],
            violations=["违规信息"],
        )
        assert r.passed is False
        assert len(r.violations) == 1


# ---------------------------------------------------------------------------
# ResultReviewResult
# ---------------------------------------------------------------------------


class TestResultReviewResult:
    """ResultReviewResult 模型测试。"""

    def test_passed(self) -> None:
        """偏离度未超标。"""
        dev = DeviationResult(score=0.1, passed=True, explanation="ok")
        r = ResultReviewResult(deviation=dev, passed=True)
        assert r.passed is True

    def test_failed(self) -> None:
        """偏离度超标。"""
        dev = DeviationResult(score=0.8, passed=False, explanation="bad")
        r = ResultReviewResult(deviation=dev, passed=False)
        assert r.passed is False


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------


class TestVerdict:
    """Verdict 模型测试。"""

    def test_constitutional_verdict(self) -> None:
        """合宪判决。"""
        v = Verdict(
            verdict_id="v-001",
            act_id="act-001",
            constitutional=True,
            ruling="合宪",
        )
        assert v.constitutional is True
        assert v.violation_type is None
        assert v.evidence == []

    def test_unconstitutional_verdict(self) -> None:
        """违宪判决。"""
        v = Verdict(
            verdict_id="v-002",
            act_id="act-002",
            constitutional=False,
            ruling="违宪：偏离度超标",
            violation_type=ViolationType.DEVIATION_EXCEEDED,
            evidence=["偏离度 0.8 > 0.3"],
            remediation="重做",
        )
        assert v.constitutional is False
        assert v.violation_type == ViolationType.DEVIATION_EXCEEDED
        assert len(v.evidence) == 1
        assert v.remediation == "重做"

    def test_created_at_default(self) -> None:
        """created_at 自动生成为 UTC 时间。"""
        v = Verdict(
            verdict_id="v-003",
            act_id="act-003",
            constitutional=True,
            ruling="ok",
        )
        assert isinstance(v.created_at, datetime)
        assert v.created_at.tzinfo == timezone.utc

    def test_serialization_roundtrip(self) -> None:
        """序列化/反序列化往返。"""
        v = Verdict(
            verdict_id="v-004",
            act_id="act-004",
            constitutional=False,
            ruling="bad",
            violation_type=ViolationType.BLACKLIST_COMMAND,
        )
        d = v.model_dump()
        v2 = Verdict.model_validate(d)
        assert v2.verdict_id == v.verdict_id
        assert v2.violation_type == v.violation_type

    def test_with_process_review(self) -> None:
        """携带过程审查结果。"""
        pr = ProcessReviewResult(passed=True, checks=[], violations=[])
        v = Verdict(
            verdict_id="v-005",
            act_id="act-005",
            constitutional=True,
            ruling="ok",
            process_review=pr,
        )
        assert v.process_review is not None
        assert v.process_review.passed is True

    def test_with_result_review(self) -> None:
        """携带结果审查结果。"""
        dev = DeviationResult(score=0.2, passed=True, explanation="ok")
        rr = ResultReviewResult(deviation=dev, passed=True)
        v = Verdict(
            verdict_id="v-006",
            act_id="act-006",
            constitutional=True,
            ruling="ok",
            result_review=rr,
        )
        assert v.result_review is not None
        assert v.result_review.passed is True


# ---------------------------------------------------------------------------
# KillReport
# ---------------------------------------------------------------------------


class TestKillReport:
    """KillReport 模型测试。"""

    def test_basic(self) -> None:
        """基本熔断报告。"""
        v = Verdict(
            verdict_id="v-100",
            act_id="act-100",
            constitutional=False,
            ruling="违宪",
        )
        kr = KillReport(
            verdict=v,
            killed_processes=["proc_1"],
            rollback_success=True,
            judgment_document="判决书内容",
        )
        assert kr.rollback_success is True
        assert len(kr.killed_processes) == 1
        assert "判决书" in kr.judgment_document

    def test_serialization(self) -> None:
        """可正确序列化。"""
        v = Verdict(
            verdict_id="v-101",
            act_id="act-101",
            constitutional=False,
            ruling="bad",
        )
        kr = KillReport(
            verdict=v,
            killed_processes=[],
            rollback_success=False,
            judgment_document="doc",
        )
        d = kr.model_dump()
        assert d["rollback_success"] is False
        kr2 = KillReport.model_validate(d)
        assert kr2.verdict.verdict_id == "v-101"
