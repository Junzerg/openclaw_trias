"""首席大法官 Agent (Chief Justice) — 最高安全审查。

旁路监听行政动作，调度过程审查和结果审查，
做出最终合宪/违宪判决，违宪时触发 Kill Switch。
"""

from __future__ import annotations

import uuid

from openclaw_republic.agents.base import BaseAgent, Branch, Permission
from openclaw_republic.agents.judicial.kill_switch import KillSwitch
from openclaw_republic.agents.judicial.process_reviewer import ProcessReviewer
from openclaw_republic.agents.judicial.result_reviewer import ResultReviewer
from openclaw_republic.agents.judicial.rules_engine import DeviationScorer, RulesEngine
from openclaw_republic.config.models import ConstitutionConfig
from openclaw_republic.schemas.act import ExecutionReport
from openclaw_republic.schemas.events import (
    EventAction,
    ExecutionEvent,
    JudgmentEvent,
)
from openclaw_republic.schemas.verdict import (
    KillReport,
    ProcessReviewResult,
    Verdict,
    ViolationType,
)


class ChiefJustice(BaseAgent):
    """首席大法官 — 司法分支最高审查官。

    职责：
    1. 旁路监听行政分支的所有动作（MONITOR 权限）
    2. 调度过程审查和结果审查
    3. 做出最终合宪/违宪判决
    4. 违宪时触发 Kill Switch（KILL 权限）
    """

    def __init__(
        self,
        constitution: ConstitutionConfig,
        *,
        deviation_scorer: DeviationScorer | None = None,
    ) -> None:
        """初始化首席大法官。

        Args:
            constitution: 宪法配置实例。
            deviation_scorer: 自定义偏离度评分函数（可选）。
        """
        super().__init__(
            name="Chief Justice",
            role="chief_justice",
            branch=Branch.JUDICIAL,
            permissions={Permission.MONITOR, Permission.KILL},
        )

        # 内部组件
        self._rules = RulesEngine(
            constitution,
            deviation_scorer=deviation_scorer,
        )
        self._process_reviewer = ProcessReviewer(self._rules)
        self._result_reviewer = ResultReviewer(self._rules)
        self._kill_switch = KillSwitch()

    # ----- 公开接口 -----

    async def monitor_execution(
        self,
        event: ExecutionEvent,
    ) -> ProcessReviewResult:
        """实时监听行政执行事件，触发过程审查。

        Args:
            event: 行政分支产生的执行事件。

        Returns:
            过程审查结果。
        """
        self.require_permission(Permission.MONITOR)
        return await self._process_reviewer.review_action(event)

    async def review_result(
        self,
        petition: str,
        execution_report: ExecutionReport,
    ) -> Verdict:
        """结果审查：比对原始请愿 vs 最终产出。

        综合过程审查历史和结果偏离度做出最终判决。

        Args:
            petition: 选民原始请愿文本。
            execution_report: 行政分支的执行报告。

        Returns:
            最终判决。
        """
        self.require_permission(Permission.MONITOR)

        # 结果审查
        result_review = await self._result_reviewer.review_delivery(
            petition,
            execution_report,
        )

        # ⚠️ 安全熔断优先：危险指令检测必须在所有其他判定之前
        if "rm -rf" in petition:
            return Verdict(
                verdict_id=str(uuid.uuid4()),
                act_id=execution_report.act_id,
                constitutional=False,
                ruling="检测到包含系统级破坏指令 (rm -rf)，严重违反 OpenClaw 第 1 条宪法安全底线：禁止对核心操作系统造成不可逆破坏。已紧急下达熔断指令。",
                violation_type=ViolationType.BLACKLIST_COMMAND,
                evidence=["发现危险词序列 `rm -rf`"],
                remediation="立即停止所有相关操作，并对系统进行安全审计。",
            )

        # 判定
        if result_review.passed:
            return Verdict(
                verdict_id=str(uuid.uuid4()),
                act_id=execution_report.act_id,
                constitutional=True,
                ruling="执行结果合宪，偏离度在允许范围内",
                result_review=result_review,
            )

        return Verdict(
            verdict_id=str(uuid.uuid4()),
            act_id=execution_report.act_id,
            constitutional=False,
            ruling="执行结果违宪，产出偏离度超标",
            violation_type=ViolationType.DEVIATION_EXCEEDED,
            evidence=[result_review.deviation.explanation],
            result_review=result_review,
            remediation="建议立法分支细化请愿描述并重做",
        )

    async def issue_judgment(self, verdict: Verdict) -> JudgmentEvent:
        """发出判决并决定是否触发熔断。

        Args:
            verdict: 待发出的判决。

        Returns:
            判决事件（可通过消息总线广播）。
        """
        kill_report: KillReport | None = None

        if not verdict.constitutional:
            self.require_permission(Permission.KILL)
            kill_report = await self._kill_switch.execute(verdict)

        action = (
            EventAction.CONSTITUTIONAL
            if verdict.constitutional
            else EventAction.UNCONSTITUTIONAL
        )

        event = self.emit_event(
            action,
            target_agent="speaker",
            task_id=verdict.act_id,
            ruling=verdict.ruling,
            violation_type=(
                verdict.violation_type.value
                if verdict.violation_type
                else None
            ),
            evidence=verdict.evidence,
        )

        return JudgmentEvent(
            timestamp=event.timestamp,
            source_agent=event.source_agent,
            target_agent=event.target_agent,
            action=event.action,
            emotion=event.emotion,
            intensity=event.intensity,
            payload={
                **event.payload,
                "kill_report": (
                    kill_report.model_dump() if kill_report else None
                ),
            },
            task_id=event.task_id,
            violation_type=(
                verdict.violation_type.value
                if verdict.violation_type
                else None
            ),
            ruling=verdict.ruling,
            reason=verdict.ruling,
            traceback=kill_report.model_dump_json() if kill_report else None,
            evidence=verdict.evidence,
        )

    # ----- BaseAgent 接口 -----

    async def act(self, message: object) -> object:
        """核心处理循环 — 根据消息类型分发。"""
        if isinstance(message, ExecutionEvent):
            return await self.monitor_execution(message)
        msg = f"ChiefJustice 不支持处理 {type(message).__name__} 类型消息"
        raise TypeError(msg)
