"""过程违宪审查 — 实时监听行政行为。

对行政执行事件进行合规检查：黑名单命令、死循环检测、
资源超限、文件类型校验。
"""

from __future__ import annotations

from openclaw_republic.agents.judicial.rules_engine import RulesEngine
from openclaw_republic.schemas.events import ExecutionEvent
from openclaw_republic.schemas.verdict import (
    ProcessReviewResult,
    RuleCheckResult,
    ViolationType,
)


class ProcessReviewer:
    """过程违宪审查 — 实时监听行政行为。"""

    def __init__(
        self,
        rules: RulesEngine,
        *,
        loop_threshold: int = 5,
    ) -> None:
        """初始化过程审查器。

        Args:
            rules: 规则引擎实例。
            loop_threshold: 同一操作连续重复多少次视为死循环。
        """
        self._rules = rules
        self._action_history: list[str] = []
        self._loop_threshold = loop_threshold

    async def review_action(self, action: ExecutionEvent) -> ProcessReviewResult:
        """审查单个行政行为。

        依次执行四项检查，汇总为 ProcessReviewResult。
        """
        checks: list[RuleCheckResult] = []
        violations: list[str] = []

        # 1. 检查命令黑名单（payload 中可能包含 command 字段）
        command = action.payload.get("command", action.tool_name)
        cmd_check = self._rules.check_command(command)
        checks.append(cmd_check)
        if not cmd_check.passed:
            violations.append(
                f"[{ViolationType.BLACKLIST_COMMAND.value}] "
                f"{cmd_check.violation_detail}",
            )

        # 2. 检查死循环
        loop_check = self._check_loop(action.tool_name)
        checks.append(loop_check)
        if not loop_check.passed:
            violations.append(
                f"[{ViolationType.INFINITE_LOOP.value}] "
                f"{loop_check.violation_detail}",
            )

        # 3. 检查资源使用
        tokens = int(action.payload.get("tokens_consumed", 0))
        time_spent = float(action.payload.get("execution_time", 0.0))
        resource_check = self._rules.check_resource_usage(tokens, time_spent)
        checks.append(resource_check)
        if not resource_check.passed:
            violations.append(
                f"[{ViolationType.RESOURCE_EXCEEDED.value}] "
                f"{resource_check.violation_detail}",
            )

        # 4. 检查文件访问
        file_path = action.payload.get("file_path", "")
        if file_path:
            file_check = self._rules.check_file_access(str(file_path))
            checks.append(file_check)
            if not file_check.passed:
                violations.append(
                    f"[{ViolationType.FILE_ACCESS_VIOLATION.value}] "
                    f"{file_check.violation_detail}",
                )

        all_passed = all(c.passed for c in checks)
        return ProcessReviewResult(
            passed=all_passed,
            checks=checks,
            violations=violations,
        )

    def _check_loop(self, tool_name: str) -> RuleCheckResult:
        """检测是否出现死循环模式。

        同一 tool_name 连续出现 ≥ loop_threshold 次即判定为死循环。
        """
        self._action_history.append(tool_name)

        # 检查最近 N 次是否全部相同
        if len(self._action_history) >= self._loop_threshold:
            recent = self._action_history[-self._loop_threshold :]
            if len(set(recent)) == 1:
                return RuleCheckResult(
                    passed=False,
                    rule_name="infinite_loop",
                    violation_detail=(
                        f"操作 {tool_name!r} 连续重复 "
                        f"{self._loop_threshold} 次，疑似死循环"
                    ),
                )
        return RuleCheckResult(passed=True, rule_name="infinite_loop")

    def reset(self) -> None:
        """重置操作历史（新法案开始时调用）。"""
        self._action_history.clear()
