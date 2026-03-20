"""单元测试 — ConflictScoreEngine 分歧度量化引擎。"""

from __future__ import annotations

import pytest

from openclaw_republic.agents.legislative.conflict_score import (
    ConflictScoreEngine,
    ConflictScoreResult,
    ConflictTrend,
)


@pytest.fixture
def engine() -> ConflictScoreEngine:
    """创建 ConflictScoreEngine 实例。"""
    return ConflictScoreEngine()


# ---------------------------------------------------------------------------
# compute() 基础测试
# ---------------------------------------------------------------------------


class TestComputeBasic:
    """compute() 基础评分测试。"""

    def test_returns_conflict_score_result(self, engine: ConflictScoreEngine) -> None:
        """返回 ConflictScoreResult 类型。"""
        result = engine.compute("提案内容", "批评内容")
        assert isinstance(result, ConflictScoreResult)

    def test_score_within_range(self, engine: ConflictScoreEngine) -> None:
        """分歧度在 0~100 范围内。"""
        result = engine.compute("任意提案", "任意批评")
        assert 0.0 <= result.score <= 100.0

    def test_empty_inputs_return_zero(self, engine: ConflictScoreEngine) -> None:
        """空输入返回 0 分。"""
        result = engine.compute("", "")
        assert result.score == 0.0
        assert result.level == "Lv1"

    def test_empty_with_whitespace(self, engine: ConflictScoreEngine) -> None:
        """仅含空白字符视为空输入。"""
        result = engine.compute("   ", "  \n\t  ")
        assert result.score == 0.0

    def test_has_four_dimensions(self, engine: ConflictScoreEngine) -> None:
        """结果包含四个维度。"""
        result = engine.compute("提案", "批评")
        assert "opposition" in result.dimensions
        assert "coverage" in result.dimensions
        assert "compromise" in result.dimensions
        assert "intensity" in result.dimensions

    def test_dimensions_within_range(self, engine: ConflictScoreEngine) -> None:
        """各维度评分在 0~100 范围。"""
        result = engine.compute("提案 proposal", "批评 critique text")
        for dim_score in result.dimensions.values():
            assert 0.0 <= dim_score <= 100.0

    def test_has_explanation(self, engine: ConflictScoreEngine) -> None:
        """结果包含非空评分理由。"""
        result = engine.compute("提案", "批评")
        assert len(result.explanation) > 0


# ---------------------------------------------------------------------------
# 分级测试
# ---------------------------------------------------------------------------


class TestLevelClassification:
    """Lv1/Lv2/Lv3 分级正确性。"""

    def test_lv1_low_conflict(self, engine: ConflictScoreEngine) -> None:
        """温和讨论（含妥协信号）应为 Lv1。"""
        result = engine.compute(
            "建议使用 Python 开发",
            "部分同意，但是可以考虑使用 Go，我接受这个方案有道理",
        )
        assert result.level == "Lv1"

    def test_lv2_or_lv3_high_conflict(self, engine: ConflictScoreEngine) -> None:
        """强烈反对（多个否定词 + 感叹号）应为 Lv2 或 Lv3。"""
        result = engine.compute(
            "建议使用 Python 开发",
            "绝对反对！不可行！这是荒谬的！错误的！危险的！必须拒绝！",
        )
        assert result.level in ("Lv2", "Lv3")
        assert result.score >= 50.0

    def test_classify_level_boundaries(self) -> None:
        """分级边界值测试。"""
        engine = ConflictScoreEngine()
        assert engine._classify_level(0.0) == "Lv1"
        assert engine._classify_level(49.99) == "Lv1"
        assert engine._classify_level(50.0) == "Lv2"
        assert engine._classify_level(80.0) == "Lv2"
        assert engine._classify_level(80.01) == "Lv3"
        assert engine._classify_level(100.0) == "Lv3"


# ---------------------------------------------------------------------------
# 维度评分逻辑测试
# ---------------------------------------------------------------------------


class TestDimensions:
    """各维度评分合理性。"""

    def test_opposition_increases_with_keywords(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """反对关键词越多，对立度越高。"""
        low = engine.compute("提案", "这还可以")
        high = engine.compute(
            "提案",
            "反对！不同意！不可行！拒绝！荒谬！",
        )
        assert high.dimensions["opposition"] > low.dimensions["opposition"]

    def test_compromise_reduces_score(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """妥协信号降低分歧度。"""
        no_compromise = engine.compute("提案", "这不行，完全无法接受的方案")
        with_compromise = engine.compute(
            "提案",
            "部分同意，可以考虑，有道理，但是需要折中，我接受",
        )
        assert with_compromise.dimensions["compromise"] < no_compromise.dimensions["compromise"]

    def test_intensity_with_exclamation(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """感叹号增加情绪强度。"""
        calm = engine.compute("提案", "这个方案需要改进")
        excited = engine.compute("提案", "这个方案需要改进！！！绝对必须修改！")
        assert excited.dimensions["intensity"] > calm.dimensions["intensity"]

    def test_rebuttal_affects_score(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """rebuttal 文本影响评分。"""
        without = engine.compute("提案", "批评")
        with_rebuttal = engine.compute(
            "提案",
            "批评",
            rebuttal="绝对反对！不可能！荒谬！",
        )
        # rebuttal 添加了更多反对词，应导致更高对立度
        assert with_rebuttal.dimensions["opposition"] >= without.dimensions["opposition"]

    def test_no_false_positive_on_english_substrings(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """英文关键词不应子串误匹配：disagree 不应触发 agree。"""
        # "disagree" 应只匹配 opposition 的 "disagree"，
        # 不应额外匹配 compromise 的 "agree"
        result = engine.compute(
            "I propose we use innovation and new technology",
            "I disagree with this unacceptable approach",
        )
        # opposition 应检测到 "disagree" 和 "unacceptable"
        assert result.dimensions["opposition"] > 0
        # compromise 不应误检到 "agree"（来自 "disagree"）
        # 或 "accept"（来自 "unacceptable"）
        # 无妥协关键词时 compromise 维度应为 80.0
        assert result.dimensions["compromise"] == 80.0

    def test_chinese_keywords_still_match(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """中文关键词仍使用子串匹配。"""
        result = engine.compute("提案内容", "绝对反对这个方案")
        assert result.dimensions["opposition"] > 0
        assert result.dimensions["intensity"] > 0  # "绝对" 命中

    def test_chinese_negation_not_false_positive(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """中文否定前缀不应触发反义匹配：'无法接受' 不应触发 '接受' 妥协信号。"""
        result = engine.compute(
            "提案",
            "这个方案我们无法接受，不认同这种做法",
        )
        # "无法接受" 不应匹配妥协关键词 "接受"
        # "不认同" 不应匹配妥协关键词 "认同"
        # 因此 compromise 应为 80.0（无妥协信号）
        assert result.dimensions["compromise"] == 80.0

    def test_genuine_compromise_with_negated_nearby(
        self,
        engine: ConflictScoreEngine,
    ) -> None:
        """否定词旁边有独立妥协词时，独立妥协词仍应命中。"""
        result = engine.compute(
            "提案",
            "无法接受全部，但部分同意其中观点，可以考虑折中",
        )
        # "无法接受" 不命中，但 "部分同意"、"可以考虑"、"折中" 应命中
        # count=3, raw = max(0, 80-45) = 35.0
        assert result.dimensions["compromise"] < 80.0


# ---------------------------------------------------------------------------
# compute_trend() 趋势测试
# ---------------------------------------------------------------------------


class TestComputeTrend:
    """趋势计算测试。"""

    def test_converging(self, engine: ConflictScoreEngine) -> None:
        """连续下降 → converging。"""
        trend = engine.compute_trend([90.0, 80.0, 60.0, 40.0, 20.0])
        assert isinstance(trend, ConflictTrend)
        assert trend.direction == "converging"
        assert trend.slope < 0

    def test_diverging(self, engine: ConflictScoreEngine) -> None:
        """连续上升 → diverging。"""
        trend = engine.compute_trend([20.0, 40.0, 60.0, 80.0, 90.0])
        assert trend.direction == "diverging"
        assert trend.slope > 0

    def test_stable(self, engine: ConflictScoreEngine) -> None:
        """波动小 → stable。"""
        trend = engine.compute_trend([50.0, 50.5, 49.5, 50.0])
        assert trend.direction == "stable"
        assert abs(trend.slope) <= 1.0

    def test_minimum_history(self, engine: ConflictScoreEngine) -> None:
        """2 条历史即可计算趋势。"""
        trend = engine.compute_trend([80.0, 30.0])
        assert isinstance(trend, ConflictTrend)
        assert len(trend.recent_scores) == 2

    def test_too_few_raises_error(self, engine: ConflictScoreEngine) -> None:
        """少于 2 条历史抛出 ValueError。"""
        with pytest.raises(ValueError, match="至少需要 2 条"):
            engine.compute_trend([50.0])

    def test_empty_raises_error(self, engine: ConflictScoreEngine) -> None:
        """空历史抛出 ValueError。"""
        with pytest.raises(ValueError, match="至少需要 2 条"):
            engine.compute_trend([])

    def test_recent_scores_preserved(self, engine: ConflictScoreEngine) -> None:
        """趋势结果保留原始分数序列。"""
        history = [70.0, 60.0, 50.0]
        trend = engine.compute_trend(history)
        assert trend.recent_scores == history


# ---------------------------------------------------------------------------
# 模型序列化测试
# ---------------------------------------------------------------------------


class TestModels:
    """ConflictScoreResult / ConflictTrend 模型测试。"""

    def test_score_result_json_roundtrip(self) -> None:
        """ConflictScoreResult 可 JSON 序列化/反序列化。"""
        result = ConflictScoreResult(
            score=65.0,
            level="Lv2",
            dimensions={
                "opposition": 70.0,
                "coverage": 50.0,
                "compromise": 60.0,
                "intensity": 80.0,
            },
            explanation="[Lv2] 立场存在一定分歧；缺少妥协意愿。",
        )
        json_str = result.model_dump_json()
        restored = ConflictScoreResult.model_validate_json(json_str)
        assert restored.score == result.score
        assert restored.level == result.level

    def test_score_validation(self) -> None:
        """score 超出范围应报错。"""
        with pytest.raises(Exception):  # noqa: B017
            ConflictScoreResult(
                score=150.0,
                level="Lv3",
                dimensions={},
                explanation="test",
            )

    def test_trend_json_roundtrip(self) -> None:
        """ConflictTrend 可 JSON 序列化/反序列化。"""
        trend = ConflictTrend(
            direction="converging",
            slope=-5.0,
            recent_scores=[80.0, 60.0, 40.0],
        )
        json_str = trend.model_dump_json()
        restored = ConflictTrend.model_validate_json(json_str)
        assert restored.direction == "converging"
        assert restored.slope == -5.0
