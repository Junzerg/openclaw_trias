"""辩论分歧度量化引擎 — Conflict Score Engine.

评分范围 0~100，驱动辩论流程控制和前端动画分级：
- Lv1 (< 50)：温和讨论
- Lv2 (50~80)：激烈辩论
- Lv3 (> 80)：严重分歧，议长控场

当前阶段使用规则引擎实现（不依赖真实 LLM），后续可扩展为 LLM-as-a-Judge。
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class ConflictScoreResult(BaseModel):
    """单轮辩论分歧度评分结果。"""

    score: float = Field(ge=0.0, le=100.0, description="分歧度总评分")
    level: Literal["Lv1", "Lv2", "Lv3"] = Field(description="分歧等级")
    dimensions: dict[str, float] = Field(description="各维度细分评分")
    explanation: str = Field(description="评分理由摘要")


class ConflictTrend(BaseModel):
    """分歧度趋势分析结果。"""

    direction: Literal["converging", "diverging", "stable"] = Field(
        description="趋势方向",
    )
    slope: float = Field(description="线性回归斜率")
    recent_scores: list[float] = Field(description="用于计算的近期分数序列")


# ---------------------------------------------------------------------------
# 关键词词表
# ---------------------------------------------------------------------------

# 否定 / 强烈反对词
_OPPOSITION_KEYWORDS: list[str] = [
    "反对",
    "不同意",
    "不可行",
    "不可能",
    "拒绝",
    "荒谬",
    "错误",
    "危险",
    "不合理",
    "不安全",
    "reject",
    "disagree",
    "impossible",
    "absurd",
    "dangerous",
    "wrong",
    "unacceptable",
]

# 妥协 / 让步词
_COMPROMISE_KEYWORDS: list[str] = [
    "可以考虑",
    "部分同意",
    "有道理",
    "折中",
    "接受",
    "认同",
    "妥协",
    "退让",
    "agree",
    "accept",
    "compromise",
    "partially",
    "consider",
    "fair point",
]

# 情绪强烈词
_INTENSITY_KEYWORDS: list[str] = [
    "绝对",
    "必须",
    "完全",
    "极其",
    "非常",
    "严重",
    "极度",
    "坚决",
    "strongly",
    "absolutely",
    "extremely",
    "critical",
    "severe",
    "must",
    "totally",
]


# ---------------------------------------------------------------------------
# 关键词匹配工具
# ---------------------------------------------------------------------------

# 中文否定前缀 — "无法接受" 中的 "接受" 不应被视为妥协信号
_CHINESE_NEGATION_PREFIXES: tuple[str, ...] = (
    "不",
    "无法",
    "没有",
    "未",
    "非",
    "难以",
    "无",
)


def _count_keywords(text: str, keywords: list[str]) -> int:
    """统计文本中命中的关键词数量。

    中文关键词使用子串匹配（中文无空格分词），
    但会检查否定前缀（如 "无法接受" 中的 "接受" 不算命中）。
    英文（纯 ASCII）关键词使用单词边界匹配，避免 "agree" 误匹配 "disagree"。

    Args:
        text: 待扫描文本。
        keywords: 关键词列表。

    Returns:
        命中的关键词数量。
    """
    lower_text = text.lower()
    count = 0
    for kw in keywords:
        if kw.isascii():
            # 英文：使用单词边界 \b 匹配
            if re.search(rf"\b{re.escape(kw)}\b", lower_text):
                count += 1
        else:
            # 中文：子串匹配 + 否定前缀排除
            idx = lower_text.find(kw)
            if idx < 0:
                continue
            # 检查关键词前面是否有否定前缀
            negated = False
            for neg in _CHINESE_NEGATION_PREFIXES:
                start = idx - len(neg)
                if start >= 0 and lower_text[start:idx] == neg:
                    negated = True
                    break
            if not negated:
                count += 1
    return count


# ---------------------------------------------------------------------------
# ConflictScoreEngine
# ---------------------------------------------------------------------------


class ConflictScoreEngine:
    """辩论分歧度量化引擎。

    评分范围 0~100：
    - Lv1 (< 50)：温和讨论，前端显示平和动画
    - Lv2 (50~80)：激烈辩论，前端显示对抗动画
    - Lv3 (> 80)：严重分歧，议长需要控场

    评分维度（规则引擎）：
    1. 立场对立度 — 否定/反对关键词密度
    2. 论点覆盖度 — 文本重叠率（是否回应对方关键内容）
    3. 妥协信号   — 让步/折中语言检测
    4. 情绪强度   — 强烈词汇与感叹号密度
    """

    def compute(
        self,
        proposal: str,
        critique: str,
        rebuttal: str | None = None,
    ) -> ConflictScoreResult:
        """计算一轮辩论的分歧度。

        Args:
            proposal: 提案文本。
            critique: 批评文本。
            rebuttal: 反驳文本（可选，首轮无反驳）。

        Returns:
            分歧度评分结果。
        """
        combined_text = critique + (rebuttal or "")

        # 空输入时返回零分
        if not proposal.strip() and not combined_text.strip():
            return ConflictScoreResult(
                score=0.0,
                level="Lv1",
                dimensions={
                    "opposition": 0.0,
                    "coverage": 0.0,
                    "compromise": 0.0,
                    "intensity": 0.0,
                },
                explanation="无有效辩论内容。",
            )

        # 计算四个维度
        opposition = self._compute_opposition(combined_text)
        coverage = self._compute_coverage(proposal, combined_text)
        compromise = self._compute_compromise(combined_text)
        intensity = self._compute_intensity(combined_text)

        # 加权汇总（权重可调）
        score = opposition * 0.30 + coverage * 0.20 + compromise * 0.25 + intensity * 0.25
        score = round(min(100.0, max(0.0, score)), 2)

        level = self._classify_level(score)

        dimensions = {
            "opposition": round(opposition, 2),
            "coverage": round(coverage, 2),
            "compromise": round(compromise, 2),
            "intensity": round(intensity, 2),
        }

        explanation = self._build_explanation(dimensions, level)

        return ConflictScoreResult(
            score=score,
            level=level,
            dimensions=dimensions,
            explanation=explanation,
        )

    def compute_trend(self, history: list[float]) -> ConflictTrend:
        """计算分歧度趋势（用于判断是否收敛）。

        使用简单线性回归计算斜率：
        - 斜率 < -1.0 → converging（收敛）
        - 斜率 > 1.0  → diverging（发散）
        - 其他        → stable（稳定）

        Args:
            history: 历史分歧度分数序列。

        Returns:
            趋势分析结果。

        Raises:
            ValueError: 历史记录少于 2 条。
        """
        if len(history) < 2:  # noqa: PLR2004
            msg = "趋势计算至少需要 2 条历史分数"
            raise ValueError(msg)

        slope = self._linear_regression_slope(history)

        if slope < -1.0:
            direction: Literal["converging", "diverging", "stable"] = "converging"
        elif slope > 1.0:
            direction = "diverging"
        else:
            direction = "stable"

        return ConflictTrend(
            direction=direction,
            slope=round(slope, 4),
            recent_scores=list(history),
        )

    # ----- 维度计算 -----

    @staticmethod
    def _compute_opposition(text: str) -> float:
        """立场对立度 — 否定/反对关键词密度。

        扫描文本中的反对关键词出现次数，映射到 0~100 分。
        中文关键词使用子串匹配，英文关键词使用分词匹配避免误判。
        """
        if not text:
            return 0.0
        count = _count_keywords(text, _OPPOSITION_KEYWORDS)
        # 每个关键词贡献约 12 分，上限 100
        return min(100.0, count * 12.0)

    @staticmethod
    def _compute_coverage(proposal: str, response: str) -> float:
        """论点覆盖度 — 文本字符集重叠率。

        覆盖度高意味着双方讨论同一话题（分歧度较高），
        覆盖度低意味着各说各话（也算分歧）。
        最终映射为"回应程度"：高覆盖 → 高分歧（直接对抗），
        低覆盖 → 中等分歧（忽视）。
        """
        if not proposal or not response:
            return 50.0  # 一方为空，给中等分歧

        # 使用简单的字词重叠
        proposal_chars = set(proposal)
        response_chars = set(response)
        overlap = len(proposal_chars & response_chars) / len(proposal_chars)
        # 高重叠 → 直接对抗 → 高分歧
        # 低重叠 → 回避 → 中等分歧
        return min(100.0, overlap * 80.0 + 20.0)

    @staticmethod
    def _compute_compromise(text: str) -> float:
        """妥协信号 — 检测让步/折中语言。

        妥协信号越多 → 分歧度越低。
        返回值为反向映射：高妥协 → 低分数。
        """
        if not text:
            return 50.0  # 无文本，中等分歧

        count = _count_keywords(text, _COMPROMISE_KEYWORDS)
        # 妥协关键词越多，分歧越低（反向映射）
        raw = max(0.0, 80.0 - count * 15.0)
        return min(100.0, raw)

    @staticmethod
    def _compute_intensity(text: str) -> float:
        """情绪强度 — 强烈词汇与感叹号密度。"""
        if not text:
            return 0.0

        # 感叹号计数
        exclamation_count = text.count("!") + text.count("！")
        # 强烈词汇计数
        keyword_count = _count_keywords(text, _INTENSITY_KEYWORDS)

        intensity_raw = exclamation_count * 10.0 + keyword_count * 8.0
        return min(100.0, intensity_raw)

    # ----- 辅助方法 -----

    @staticmethod
    def _classify_level(score: float) -> Literal["Lv1", "Lv2", "Lv3"]:
        """根据分数分级。

        Args:
            score: 分歧度总评分 (0~100)。

        Returns:
            分级标签。
        """
        if score < 50.0:  # noqa: PLR2004
            return "Lv1"
        if score <= 80.0:  # noqa: PLR2004
            return "Lv2"
        return "Lv3"

    @staticmethod
    def _linear_regression_slope(values: list[float]) -> float:
        """计算简单线性回归斜率。

        Args:
            values: 数值序列（至少 2 个元素）。

        Returns:
            斜率值。
        """
        n = len(values)
        x_mean = (n - 1) / 2.0
        y_mean = sum(values) / n

        numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(values))
        denominator = sum((i - x_mean) ** 2 for i in range(n))

        if denominator == 0:
            return 0.0
        return numerator / denominator

    @staticmethod
    def _build_explanation(dimensions: dict[str, float], level: str) -> str:
        """生成评分理由摘要。

        Args:
            dimensions: 各维度分数。
            level: 分级标签。

        Returns:
            人类可读的评分解释。
        """
        parts: list[str] = []

        opposition = dimensions.get("opposition", 0.0)
        if opposition > 60:  # noqa: PLR2004
            parts.append("双方立场存在明显对立")
        elif opposition > 30:  # noqa: PLR2004
            parts.append("立场存在一定分歧")
        else:
            parts.append("立场对立度较低")

        compromise = dimensions.get("compromise", 0.0)
        if compromise < 40:  # noqa: PLR2004
            parts.append("出现较多妥协信号")
        elif compromise > 70:  # noqa: PLR2004
            parts.append("缺少妥协意愿")

        intensity = dimensions.get("intensity", 0.0)
        if intensity > 60:  # noqa: PLR2004
            parts.append("情绪表达较为激烈")

        return f"[{level}] " + "；".join(parts) + "。"
