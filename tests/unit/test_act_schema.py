"""单元测试 — 《执行法案》Schema (Act, ActStep, DebateRecord, ActVoteRecord)。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ActVoteRecord,
    DebateRecord,
)


# ---------------------------------------------------------------------------
# ActStep 测试
# ---------------------------------------------------------------------------


class TestActStep:
    """ActStep 数据模型测试。"""

    def test_creation(self) -> None:
        """ActStep 可正常创建。"""
        step = ActStep(
            index=0,
            description="安装依赖包",
            required_skill="CodeExecution",
            estimated_tokens=5000,
            acceptance_criteria="pip install 成功",
        )
        assert step.index == 0
        assert step.required_skill == "CodeExecution"
        assert step.tool_parameters == {}
        assert step.dependencies == []

    def test_with_dependencies(self) -> None:
        """ActStep 可指定依赖。"""
        step = ActStep(
            index=2,
            description="运行测试",
            required_skill="CodeExecution",
            estimated_tokens=3000,
            acceptance_criteria="pytest 全绿",
            dependencies=[0, 1],
        )
        assert step.dependencies == [0, 1]

    def test_with_tool_parameters(self) -> None:
        """ActStep 可指定工具参数。"""
        step = ActStep(
            index=0,
            description="搜索资料",
            required_skill="WebBrowser",
            tool_parameters={"url": "https://example.com", "timeout": 30},
            estimated_tokens=2000,
            acceptance_criteria="获取到目标数据",
        )
        assert step.tool_parameters["url"] == "https://example.com"

    def test_index_must_be_non_negative(self) -> None:
        """index 必须 >= 0。"""
        with pytest.raises(Exception):  # noqa: B017
            ActStep(
                index=-1,
                description="无效步骤",
                required_skill="CodeExecution",
                estimated_tokens=1000,
                acceptance_criteria="N/A",
            )

    def test_estimated_tokens_must_be_non_negative(self) -> None:
        """estimated_tokens 必须 >= 0。"""
        with pytest.raises(Exception):  # noqa: B017
            ActStep(
                index=0,
                description="无效步骤",
                required_skill="CodeExecution",
                estimated_tokens=-100,
                acceptance_criteria="N/A",
            )

    def test_json_roundtrip(self) -> None:
        """ActStep JSON 序列化/反序列化。"""
        step = ActStep(
            index=1,
            description="编写代码",
            required_skill="Python_Interpreter",
            estimated_tokens=8000,
            acceptance_criteria="代码可运行",
        )
        json_str = step.model_dump_json()
        restored = ActStep.model_validate_json(json_str)
        assert restored.index == step.index
        assert restored.description == step.description


# ---------------------------------------------------------------------------
# DebateRecord 测试
# ---------------------------------------------------------------------------


class TestDebateRecord:
    """DebateRecord 数据模型测试。"""

    def test_creation(self) -> None:
        """DebateRecord 可正常创建。"""
        record = DebateRecord(
            total_rounds=5,
            final_conflict_score=25.0,
            consensus_points=["使用 Python", "添加类型注解"],
            remaining_concerns=["性能待优化"],
        )
        assert record.total_rounds == 5
        assert record.final_conflict_score == 25.0
        assert len(record.consensus_points) == 2
        assert len(record.remaining_concerns) == 1

    def test_defaults(self) -> None:
        """DebateRecord 使用默认值。"""
        record = DebateRecord(
            total_rounds=1,
            final_conflict_score=0.0,
        )
        assert record.consensus_points == []
        assert record.remaining_concerns == []

    def test_score_validation(self) -> None:
        """final_conflict_score 超出范围应报错。"""
        with pytest.raises(Exception):  # noqa: B017
            DebateRecord(
                total_rounds=1,
                final_conflict_score=150.0,
            )


# ---------------------------------------------------------------------------
# ActVoteRecord 测试
# ---------------------------------------------------------------------------


class TestActVoteRecord:
    """ActVoteRecord 数据模型测试。"""

    def test_creation_passed(self) -> None:
        """表决通过的记录。"""
        record = ActVoteRecord(
            ayes=3,
            nays=1,
            result="passed",
            voter_positions={
                "radical_mp": "aye",
                "conservative_mp": "nay",
                "speaker": "aye",
            },
        )
        assert record.result == "passed"
        assert record.ayes == 3

    def test_creation_rejected(self) -> None:
        """表决驳回的记录。"""
        record = ActVoteRecord(
            ayes=1,
            nays=2,
            result="rejected",
        )
        assert record.result == "rejected"
        assert record.voter_positions == {}

    def test_invalid_result(self) -> None:
        """无效的 result 值应报错。"""
        with pytest.raises(Exception):  # noqa: B017
            ActVoteRecord(
                ayes=1,
                nays=1,
                result="unknown",  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# Act 测试
# ---------------------------------------------------------------------------


def _make_act(**overrides: object) -> Act:
    """创建测试用 Act 的辅助函数。"""
    defaults: dict[str, object] = {
        "act_id": "test-act-001",
        "title": "测试法案",
        "summary": "这是一个测试法案摘要",
        "petition_origin": "请帮我编写一个 Python 脚本",
        "steps": [
            ActStep(
                index=0,
                description="编写脚本",
                required_skill="CodeExecution",
                estimated_tokens=5000,
                acceptance_criteria="脚本可运行",
            ),
        ],
        "total_estimated_tokens": 5000,
        "debate_record": DebateRecord(
            total_rounds=3,
            final_conflict_score=20.0,
            consensus_points=["使用 Python 3.12"],
            remaining_concerns=[],
        ),
        "vote_record": ActVoteRecord(
            ayes=2,
            nays=0,
            result="passed",
            voter_positions={"radical_mp": "aye", "conservative_mp": "aye"},
        ),
    }
    defaults.update(overrides)
    return Act(**defaults)  # type: ignore[arg-type]


class TestAct:
    """Act 数据模型测试。"""

    def test_creation(self) -> None:
        """Act 可完整创建。"""
        act = _make_act()
        assert act.act_id == "test-act-001"
        assert act.title == "测试法案"
        assert len(act.steps) == 1
        assert act.total_estimated_tokens == 5000

    def test_has_created_at(self) -> None:
        """Act 自动生成 created_at 时间戳。"""
        act = _make_act()
        assert isinstance(act.created_at, datetime)

    def test_custom_created_at(self) -> None:
        """Act 支持自定义 created_at。"""
        custom_time = datetime(2025, 1, 1, tzinfo=timezone.utc)
        act = _make_act(created_at=custom_time)
        assert act.created_at == custom_time

    def test_multiple_steps(self) -> None:
        """Act 可包含多个步骤。"""
        steps = [
            ActStep(
                index=0,
                description="步骤一",
                required_skill="CodeExecution",
                estimated_tokens=3000,
                acceptance_criteria="完成",
            ),
            ActStep(
                index=1,
                description="步骤二",
                required_skill="WebBrowser",
                estimated_tokens=2000,
                acceptance_criteria="完成",
                dependencies=[0],
            ),
        ]
        act = _make_act(steps=steps, total_estimated_tokens=5000)
        assert len(act.steps) == 2
        assert act.steps[1].dependencies == [0]

    def test_empty_steps_raises(self) -> None:
        """Act 至少需要 1 个步骤（min_length=1）。"""
        with pytest.raises(Exception):  # noqa: B017
            _make_act(steps=[])

    def test_json_roundtrip(self) -> None:
        """Act 完整 JSON 序列化/反序列化。"""
        act = _make_act()
        json_str = act.model_dump_json()
        restored = Act.model_validate_json(json_str)
        assert restored.act_id == act.act_id
        assert restored.title == act.title
        assert len(restored.steps) == len(act.steps)
        assert restored.debate_record.total_rounds == act.debate_record.total_rounds
        assert restored.vote_record.result == act.vote_record.result

    def test_total_tokens_non_negative(self) -> None:
        """total_estimated_tokens 必须 >= 0。"""
        with pytest.raises(Exception):  # noqa: B017
            _make_act(total_estimated_tokens=-1)

    def test_debate_record_embedded(self) -> None:
        """辩论记录正确嵌入法案。"""
        act = _make_act()
        assert act.debate_record.total_rounds == 3
        assert act.debate_record.final_conflict_score == 20.0
        assert "使用 Python 3.12" in act.debate_record.consensus_points

    def test_vote_record_embedded(self) -> None:
        """表决记录正确嵌入法案。"""
        act = _make_act()
        assert act.vote_record.ayes == 2
        assert act.vote_record.result == "passed"
        assert act.vote_record.voter_positions["radical_mp"] == "aye"


# ---------------------------------------------------------------------------
# Act 与 DebateResult 对接测试
# ---------------------------------------------------------------------------


class TestActDebateIntegration:
    """法案与辩论引擎产出对接测试。"""

    def test_act_from_debate_data(self) -> None:
        """使用类似辩论引擎输出的数据构建法案。"""
        # 模拟辩论输出
        debate_record = DebateRecord(
            total_rounds=5,
            final_conflict_score=28.5,
            consensus_points=["使用 FastAPI 框架", "添加单元测试"],
            remaining_concerns=["部署方案待定"],
        )
        vote_record = ActVoteRecord(
            ayes=2,
            nays=1,
            result="passed",
            voter_positions={
                "radical_mp": "aye",
                "conservative_mp": "nay",
                "speaker": "aye",
            },
        )

        act = Act(
            act_id="act-debate-001",
            title="FastAPI 服务法案",
            summary="使用 FastAPI 构建 REST API 服务",
            petition_origin="请帮我创建一个 Web API",
            steps=[
                ActStep(
                    index=0,
                    description="初始化 FastAPI 项目",
                    required_skill="CodeExecution",
                    estimated_tokens=3000,
                    acceptance_criteria="项目可运行",
                ),
                ActStep(
                    index=1,
                    description="编写端点",
                    required_skill="CodeExecution",
                    estimated_tokens=5000,
                    acceptance_criteria="端点响应 200",
                    dependencies=[0],
                ),
                ActStep(
                    index=2,
                    description="编写测试",
                    required_skill="CodeExecution",
                    estimated_tokens=2000,
                    acceptance_criteria="pytest 全绿",
                    dependencies=[0, 1],
                ),
            ],
            total_estimated_tokens=10000,
            debate_record=debate_record,
            vote_record=vote_record,
        )

        assert act.act_id == "act-debate-001"
        assert len(act.steps) == 3
        assert act.debate_record.total_rounds == 5
        assert act.vote_record.result == "passed"
        assert act.total_estimated_tokens == 10000
