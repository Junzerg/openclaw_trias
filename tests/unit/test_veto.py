"""单元测试 — Veto 机制。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.executive.president import President
from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ActVoteRecord,
    DebateRecord,
    VetoNotice,
)


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_act(
    *,
    total_tokens: int = 10_000,
    skills: list[str] | None = None,
    act_id: str = "act-veto-001",
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
        summary="用于 Veto 单测的法案",
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
# Token 超限否决
# ---------------------------------------------------------------------------


class TestVetoTokenBudget:
    """Token 预算超限触发 Veto。"""

    @pytest.mark.asyncio
    async def test_veto_when_over_budget(self) -> None:
        """法案 Token 超出预算时否决。"""
        p = President(token_budget=5_000)
        act = _make_act(total_tokens=10_000)
        result = await p.review_act(act)
        assert isinstance(result, VetoNotice)

    @pytest.mark.asyncio
    async def test_veto_notice_contains_token_issue(self) -> None:
        """否决通知中包含 Token 超限的具体信息。"""
        p = President(token_budget=5_000)
        act = _make_act(total_tokens=10_000)
        result = await p.review_act(act)
        assert result is not None
        assert any("Token" in issue or "token" in issue for issue in result.specific_issues)

    @pytest.mark.asyncio
    async def test_veto_notice_act_id(self) -> None:
        """否决通知的 act_id 与法案一致。"""
        p = President(token_budget=1_000)
        act = _make_act(total_tokens=10_000, act_id="act-xyz")
        result = await p.review_act(act)
        assert result is not None
        assert result.act_id == "act-xyz"

    @pytest.mark.asyncio
    async def test_veto_notice_has_reason(self) -> None:
        """否决通知包含理由。"""
        p = President(token_budget=1_000)
        act = _make_act(total_tokens=10_000)
        result = await p.review_act(act)
        assert result is not None
        assert len(result.reason) > 0

    @pytest.mark.asyncio
    async def test_veto_notice_has_suggestion(self) -> None:
        """否决通知包含修改建议。"""
        p = President(token_budget=1_000)
        act = _make_act(total_tokens=10_000)
        result = await p.review_act(act)
        assert result is not None
        assert result.suggestion is not None


# ---------------------------------------------------------------------------
# Skill 不可用否决
# ---------------------------------------------------------------------------


class TestVetoSkillUnavailable:
    """Skill 不可用触发 Veto。"""

    @pytest.mark.asyncio
    async def test_veto_when_skill_unavailable(self) -> None:
        """法案所需 Skill 不可用时否决。"""
        p = President(
            token_budget=50_000,
            available_skills={"CodeExecution"},
        )
        act = _make_act(skills=["MagicWand"])
        result = await p.review_act(act)
        assert isinstance(result, VetoNotice)

    @pytest.mark.asyncio
    async def test_veto_notice_contains_skill_issue(self) -> None:
        """否决通知中说明哪个 Skill 不可用。"""
        p = President(
            token_budget=50_000,
            available_skills={"CodeExecution"},
        )
        act = _make_act(skills=["Teleportation"])
        result = await p.review_act(act)
        assert result is not None
        assert any("Teleportation" in issue for issue in result.specific_issues)

    @pytest.mark.asyncio
    async def test_veto_multiple_unavailable_skills(self) -> None:
        """多个 Skill 不可用时否决通知列出全部。"""
        p = President(
            token_budget=50_000,
            available_skills={"CodeExecution"},
        )
        act = _make_act(skills=["MagicWand", "TimeMachine"])
        result = await p.review_act(act)
        assert result is not None
        assert len(result.specific_issues) >= 2

    @pytest.mark.asyncio
    async def test_partial_skill_unavailable(self) -> None:
        """部分 Skill 可用但有不可用的也否决。"""
        p = President(
            token_budget=50_000,
            available_skills={"CodeExecution"},
        )
        act = _make_act(skills=["CodeExecution", "UnknownSkill"])
        result = await p.review_act(act)
        assert isinstance(result, VetoNotice)


# ---------------------------------------------------------------------------
# Token + Skill 双重问题
# ---------------------------------------------------------------------------


class TestVetoCombined:
    """Token 超限与 Skill 不可用同时触发。"""

    @pytest.mark.asyncio
    async def test_veto_both_issues(self) -> None:
        """Token 超限 + Skill 不可用 → 否决通知包含两类问题。"""
        p = President(
            token_budget=1_000,
            available_skills={"CodeExecution"},
        )
        act = _make_act(total_tokens=10_000, skills=["UnknownSkill"])
        result = await p.review_act(act)
        assert result is not None
        assert len(result.specific_issues) >= 2
        # 至少一个是 Token 相关
        assert any("Token" in i or "token" in i for i in result.specific_issues)
        # 至少一个是 Skill 相关
        assert any("UnknownSkill" in i for i in result.specific_issues)


# ---------------------------------------------------------------------------
# VetoNotice 模型完整性
# ---------------------------------------------------------------------------


class TestVetoNoticeModel:
    """VetoNotice 数据模型测试。"""

    def test_creation(self) -> None:
        """VetoNotice 可正常创建。"""
        notice = VetoNotice(
            act_id="act-001",
            reason="Token 超限",
            specific_issues=["预算不足"],
            suggestion="减少步骤",
        )
        assert notice.act_id == "act-001"
        assert notice.reason == "Token 超限"
        assert len(notice.specific_issues) == 1
        assert notice.suggestion == "减少步骤"

    def test_suggestion_optional(self) -> None:
        """suggestion 字段可为 None。"""
        notice = VetoNotice(
            act_id="act-002",
            reason="Skill 不可用",
            specific_issues=["Missing Skill"],
        )
        assert notice.suggestion is None

    def test_specific_issues_at_least_one(self) -> None:
        """specific_issues 至少需要一项。"""
        with pytest.raises(Exception):  # noqa: B017
            VetoNotice(
                act_id="act-003",
                reason="无问题？",
                specific_issues=[],
            )

    def test_json_roundtrip(self) -> None:
        """VetoNotice JSON 序列化/反序列化。"""
        notice = VetoNotice(
            act_id="act-rt",
            reason="测试",
            specific_issues=["issue-a", "issue-b"],
            suggestion="fix it",
        )
        json_str = notice.model_dump_json()
        restored = VetoNotice.model_validate_json(json_str)
        assert restored.act_id == notice.act_id
        assert restored.specific_issues == notice.specific_issues
