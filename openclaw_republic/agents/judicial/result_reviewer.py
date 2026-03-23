"""结果违宪审查 — 交付前验收。

比对选民原始请愿与最终执行产出，通过 LLM-as-a-Judge
评估偏离度以检测幻觉或目标偏移。
"""

from __future__ import annotations

from openclaw_republic.agents.judicial.rules_engine import RulesEngine
from openclaw_republic.schemas.act import ExecutionReport
from openclaw_republic.schemas.verdict import ResultReviewResult


class ResultReviewer:
    """结果违宪审查 — 交付前验收。"""

    def __init__(self, rules: RulesEngine) -> None:
        """初始化结果审查器。

        Args:
            rules: 规则引擎实例。
        """
        self._rules = rules

    async def review_delivery(
        self,
        petition: str,
        execution_report: ExecutionReport,
    ) -> ResultReviewResult:
        """审查执行结果是否偏离原始请愿。

        从执行报告中提取产出文本，调用规则引擎的偏离度检查。

        Args:
            petition: 选民原始请愿文本。
            execution_report: 行政分支的执行报告。

        Returns:
            结果审查汇总。
        """
        # 从所有成功步骤中拼接产出
        outputs = [
            r.output
            for r in execution_report.task_results
            if r.status == "success" and r.output
        ]
        combined_output = "\n".join(outputs) if outputs else "(无有效产出)"

        deviation = await self._rules.check_deviation(petition, combined_output)
        return ResultReviewResult(
            deviation=deviation,
            passed=deviation.passed,
        )
