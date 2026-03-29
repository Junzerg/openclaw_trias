"""物理熔断机制 — 违宪判定后的强制终止与回滚。

当前实现为 Mock 版本：模拟进程终止和状态回滚，
生成完整判决书文本。真实容器 Kill 由后续 Task 实现。
"""

from __future__ import annotations

from datetime import datetime, timezone

from openclaw_republic.schemas.verdict import KillReport, Verdict


class KillSwitch:
    """物理熔断 — 违宪判定后的强制终止与回滚。"""

    async def execute(self, verdict: Verdict) -> KillReport:
        """执行熔断。

        1. 强制 Kill 正在执行的容器/进程（Mock）
        2. 回滚状态到执行前（Mock）
        3. 生成判决书（含违宪理由 + 证据）
        4. 通知立法分支重做（由消息总线处理，此处仅标记）

        Args:
            verdict: 触发熔断的违宪判决。

        Returns:
            熔断报告。
        """
        # Mock：记录模拟 kill 的进程
        killed = [f"mock_process_{verdict.act_id}"]

        # Mock：回滚总是成功
        rollback_ok = True

        # 生成判决书文本
        doc = self._generate_judgment_document(verdict)

        return KillReport(
            verdict=verdict,
            killed_processes=killed,
            rollback_success=rollback_ok,
            judgment_document=doc,
        )

    @staticmethod
    def _generate_judgment_document(verdict: Verdict) -> str:
        """生成完整判决书文本。"""
        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        lines = [
            "=" * 60,
            "       JUDGMENT OF THE SUPREME COURT",
            "=" * 60,
            f"判决编号: {verdict.verdict_id}",
            f"法案编号: {verdict.act_id}",
            f"判决时间: {now}",
            "-" * 60,
            f"判决结果: {'合宪 (CONSTITUTIONAL)' if verdict.constitutional else '违宪 (UNCONSTITUTIONAL)'}",
            f"判决摘要: {verdict.ruling}",
        ]

        if verdict.violation_type is not None:
            lines.append(f"违宪类型: {verdict.violation_type.value}")

        if verdict.evidence:
            lines.append("-" * 60)
            lines.append("证据:")
            for i, ev in enumerate(verdict.evidence, 1):
                lines.append(f"  {i}. {ev}")

        if verdict.remediation:
            lines.append("-" * 60)
            lines.append(f"补救建议: {verdict.remediation}")

        lines.append("=" * 60)
        return "\n".join(lines)
