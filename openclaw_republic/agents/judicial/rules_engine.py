"""违宪规则引擎 — 基于 constitution.yaml 的自动化审查。

从 ``ConstitutionConfig`` 加载规则集，提供过程审查
（命令黑名单、文件扩展名、资源用量）和结果审查（偏离度）。
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Awaitable, Callable

from openclaw_republic.config.models import ConstitutionConfig
from openclaw_republic.schemas.verdict import DeviationResult, RuleCheckResult


# 偏离度评分函数类型：(petition, output) → float (0~1)
DeviationScorer = Callable[[str, str], Awaitable[float]]


async def _default_deviation_scorer(petition: str, output: str) -> float:
    """默认 Mock LLM 评分 — 固定返回低偏离度。"""
    # 在实际部署中，这里会调用 LLM-as-a-Judge
    _ = petition, output
    return 0.1


class RulesEngine:
    """违宪规则引擎 — 基于宪法配置进行合规校验。"""

    def __init__(
        self,
        constitution: ConstitutionConfig,
        *,
        deviation_scorer: DeviationScorer | None = None,
    ) -> None:
        """初始化规则引擎。

        Args:
            constitution: 宪法配置实例。
            deviation_scorer: 自定义偏离度评分函数（可选，默认 Mock）。
        """
        self._blacklist: list[str] = list(constitution.judicial.blacklist_commands)
        self._allowed_extensions: list[str] = list(
            constitution.security.allowed_file_extensions,
        )
        self._max_tokens: int = constitution.judicial.token_budget.max_per_task
        self._max_execution_time: int = (
            constitution.security.max_execution_time_seconds
        )
        self._deviation_max: float = constitution.judicial.deviation.max_score
        self._deviation_scorer: DeviationScorer = (
            deviation_scorer or _default_deviation_scorer
        )

    # ─── 过程审查 (Process Review) ──────────────────

    def check_command(self, command: str) -> RuleCheckResult:
        """检测命令是否命中黑名单。

        采用子串匹配：命令文本中包含任一黑名单条目即判定违规。
        """
        cmd_lower = command.lower()
        for banned in self._blacklist:
            if banned.lower() in cmd_lower:
                return RuleCheckResult(
                    passed=False,
                    rule_name="blacklist_command",
                    violation_detail=f"命令包含黑名单项: {banned!r}",
                )
        return RuleCheckResult(passed=True, rule_name="blacklist_command")

    def check_file_access(self, file_path: str) -> RuleCheckResult:
        """检测文件访问是否合规（扩展名白名单）。"""
        suffix = PurePosixPath(file_path).suffix
        if not suffix:
            # 无扩展名文件（如 Makefile, Dockerfile）视为合规
            return RuleCheckResult(passed=True, rule_name="file_access")
        if suffix in self._allowed_extensions:
            return RuleCheckResult(passed=True, rule_name="file_access")
        return RuleCheckResult(
            passed=False,
            rule_name="file_access",
            violation_detail=f"文件扩展名 {suffix!r} 不在白名单中",
        )

    def check_resource_usage(
        self,
        tokens_consumed: int,
        execution_time: float,
    ) -> RuleCheckResult:
        """检测资源使用是否超限。"""
        if tokens_consumed > self._max_tokens:
            return RuleCheckResult(
                passed=False,
                rule_name="resource_usage",
                violation_detail=(
                    f"Token 消耗 {tokens_consumed} 超过上限 {self._max_tokens}"
                ),
            )
        if execution_time > self._max_execution_time:
            return RuleCheckResult(
                passed=False,
                rule_name="resource_usage",
                violation_detail=(
                    f"执行时间 {execution_time:.1f}s 超过上限 "
                    f"{self._max_execution_time}s"
                ),
            )
        return RuleCheckResult(passed=True, rule_name="resource_usage")

    # ─── 结果审查 (Result Review) ───────────────────

    async def check_deviation(
        self,
        petition: str,
        output: str,
    ) -> DeviationResult:
        """LLM-as-a-Judge 评估产出与请愿的偏离度。

        偏离度 score ∈ [0, 1]，超过 max_score 则判定违宪。
        """
        score = await self._deviation_scorer(petition, output)
        # 夹紧到 [0, 1]
        score = max(0.0, min(1.0, score))
        passed = score <= self._deviation_max
        explanation = (
            f"偏离度 {score:.2f} {'<=' if passed else '>'} "
            f"阈值 {self._deviation_max:.2f}"
        )
        return DeviationResult(
            score=score,
            passed=passed,
            explanation=explanation,
        )
